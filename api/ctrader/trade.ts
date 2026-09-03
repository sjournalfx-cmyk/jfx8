import type { VercelRequest, VercelResponse } from '@vercel/node';
import WebSocket from 'ws';
import { createHash } from 'crypto';
import {
  extractRawApiKey,
  isJfxApiKey,
  parseIsDemo,
  hasTradeScope,
  toVolumeCents,
  chooseCtraderAccount,
  findAltAccountForHost,
  isFallbackWorthyCtraderError,
  apiKeyError,
  persistRotatedCtraderToken,
} from '../_lib/jfxApiKey.js';

const CTRADER_TOKEN_URL = 'https://openapi.ctrader.com/apps/token';

function getCredentials() {
  return {
    clientId: (process.env.CTRADER_CLIENT_ID || process.env.VITE_CTRADER_CLIENT_ID || '').trim(),
    clientSecret: (process.env.CTRADER_CLIENT_SECRET || process.env.VITE_CTRADER_CLIENT_SECRET || '').trim(),
    supabaseUrl: (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, ''),
    serviceKey: (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
  };
}

const PT = {
  APPLICATION_AUTH_REQ: 2100,
  ACCOUNT_AUTH_REQ: 2102,
  NEW_ORDER_REQ: 2106,
  CANCEL_ORDER_REQ: 2108,
  AMEND_ORDER_REQ: 2109,
  AMEND_POSITION_SLTP_REQ: 2110,
  CLOSE_POSITION_REQ: 2111,
  SYMBOLS_LIST_REQ: 2114,
  RECONCILE_REQ: 2124,
  GET_ACCOUNTS_BY_TOKEN_REQ: 2149,
  ERROR_RES: 2142,
};

function hashToken(raw: string): string {
  try { return createHash('sha256').update(raw).digest('hex'); } catch (e: any) {
    // Fallback: simple hex via Buffer if crypto fails (should not happen)
    console.error('[trade] createHash failed', e?.message);
    throw new Error('hash_failed: ' + (e?.message || String(e)));
  }
}

interface WsSession {
  send: (payloadType: number, payload: Record<string, any>) => Promise<any>;
  close: () => void;
}

function openCtraderSession(
  host: string,
  clientId: string,
  clientSecret: string,
  ctidTraderAccountId: number,
  accessToken: string,
  timeoutMs: number = 25000
): Promise<WsSession> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(`wss://${host}:5036`);
    } catch (e) {
      return reject(e);
    }

    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error(`Connection timeout to ${host}`));
    }, timeoutMs);

    let msgId = 0;
    const pending = new Map<string, { resolve: (v: any) => void; reject: (err: any) => void }>();

    const send = (payloadType: number, payload: Record<string, any>): Promise<any> =>
      new Promise((res, rej) => {
        const clientMsgId = `api_${++msgId}_${Date.now()}`;
        pending.set(clientMsgId, { resolve: res, reject: rej });
        ws.send(JSON.stringify({ clientMsgId, payloadType, payload }));
      });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.clientMsgId && pending.has(msg.clientMsgId)) {
          const p = pending.get(msg.clientMsgId)!;
          pending.delete(msg.clientMsgId);
          if (msg.payloadType === PT.ERROR_RES) {
            const desc = msg.payload?.description || msg.payload?.errorCode || 'cTrader Error';
            p.reject(new Error(desc));
          } else {
            p.resolve(msg.payload);
          }
        }
      } catch {}
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    ws.on('open', async () => {
      try {
        await send(PT.APPLICATION_AUTH_REQ, { clientId, clientSecret });
        if (ctidTraderAccountId && ctidTraderAccountId > 0) {
          await send(PT.ACCOUNT_AUTH_REQ, { ctidTraderAccountId, accessToken });
        }

        clearTimeout(timer);
        resolve({
          send,
          close: () => {
            try { ws.close(); } catch {}
          },
        });
      } catch (err) {
        clearTimeout(timer);
        try { ws.close(); } catch {}
        reject(err);
      }
    });
  });
}

/**
 * Mint a fresh cTrader access token from the refresh token stored in DB.
 * Returns both tokens so callers can persist rotation via upsert (never PATCH-only).
 */
async function mintAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string | null }> {
  const tokenUrl = new URL(CTRADER_TOKEN_URL);
  tokenUrl.searchParams.set('grant_type', 'refresh_token');
  tokenUrl.searchParams.set('refresh_token', refreshToken);
  tokenUrl.searchParams.set('client_id', clientId);
  tokenUrl.searchParams.set('client_secret', clientSecret);

  const res = await fetch(tokenUrl.toString(), {
    headers: { Accept: 'application/json' },
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.errorCode || !body.accessToken) {
    const msg = body.description || body.errorCode || `cTrader refresh failed (HTTP ${res.status})`;
    throw new Error(msg);
  }

  return {
    accessToken: String(body.accessToken),
    refreshToken: body.refreshToken ? String(body.refreshToken) : null,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const startTime = Date.now();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, X-Access-Token');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const { clientId, clientSecret, supabaseUrl, serviceKey } = getCredentials();
  if (!clientId || !clientSecret) {
    res.status(503).json({ error: 'cTrader credentials not configured on server' });
    return;
  }

  const rawKey = extractRawApiKey(req.headers as Record<string, string | string[] | undefined>);

  const body = (typeof req.body === 'object' && req.body !== null) ? req.body : {};
  const action = String(body.action || req.query.action || (req.method === 'GET' ? 'get_positions' : 'open')).toLowerCase();
  const isReadAction = action === 'get_positions' || action === 'positions' || action === 'get_accounts' || action === 'accounts' || action === 'check_auth' || action === 'auth_status' || req.method === 'GET';

  let accessToken = '';
  let authenticatedUserId: string | null = null;
  let keyId: string | null = null;
  let defaultAccountId: number | null = null;
  let defaultIsDemo = true;

  // ---------------------------------------------------------------------------
  // AUTHENTICATION STRATEGY:
  // 1. JFX Personal API Key (X-API-Key: jfx_pat_...) -> SECURE & RECOMMENDED
  // 2. Direct cTrader Access Token (Authorization: Bearer <raw_token>) -> BACKWARD COMPAT
  // ---------------------------------------------------------------------------
  try {
  if (isJfxApiKey(rawKey)) {
    if (!supabaseUrl || !serviceKey) {
      res.status(503).json(apiKeyError('service_unavailable', 'Database service not configured on server'));
      return;
    }

    let keyHash: string;
    try { keyHash = hashToken(rawKey); } catch (e: any) { res.status(500).json(apiKeyError('hash_failed', e?.message || String(e))); return; }
    const keyQueryRes = await fetch(`${supabaseUrl}/rest/v1/api_keys?key_hash=eq.${keyHash}&select=id,user_id,scopes,expires_at`, {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
    });

    const keyRows = await keyQueryRes.json().catch(() => []);
    const apiKey = Array.isArray(keyRows) ? keyRows[0] : null;

    if (!apiKey) {
      res.status(401).json(apiKeyError('invalid_api_key', 'API key not recognised. Copy the full key from Settings → Developer Tools (it starts with jfx_pat_) and send it as X-API-Key or Authorization: Bearer.'));
      return;
    }

    if (apiKey.expires_at && new Date(apiKey.expires_at).getTime() <= Date.now()) {
      res.status(401).json(apiKeyError('expired_api_key', 'This API key has expired. Create a new one in Settings → Developer Tools.'));
      return;
    }

    const scopes: string[] = apiKey.scopes || [];
    const requiredScope = isReadAction ? 'trades:read' : 'trades:write';
    if (!hasTradeScope(scopes, requiredScope as 'trades:read' | 'trades:write')) {
      res.status(403).json(apiKeyError('insufficient_scope', requiredScope === 'trades:write' ? 'This key lacks trades:write. Recreate it in Settings → Developer Tools with trades:write enabled.' : 'This key lacks trades:read (or trades:write).', { need: requiredScope, have: scopes, hint: requiredScope === 'trades:write' ? 'Recreate the key in Settings → Developer Tools with trades:write enabled' : 'Requires trades:read (or trades:write)' }));
      return;
    }

    authenticatedUserId = apiKey.user_id;
    keyId = apiKey.id;

    // Rate limiting check via consume_api_key_rate_limit RPC.
    // 429 only when the limiter explicitly denies; transport/RPC errors are 503
    // so a missing migration is never misreported as "rate limited".
    try {
      const rateLimitRes = await fetch(`${supabaseUrl}/rest/v1/rpc/consume_api_key_rate_limit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ p_user_id: authenticatedUserId, p_key_id: keyId }),
      });
      if (!rateLimitRes.ok) {
        res.status(503).json(apiKeyError('rate_limiter_unavailable', 'Rate-limiter check failed on the server. Try again shortly.'));
        return;
      }
      const allowed = await rateLimitRes.json().catch(() => true);
      if (allowed === false) {
        res.setHeader('Retry-After', '60');
        res.status(429).json(apiKeyError('rate_limited', 'Too many requests for this key. Wait 60s and retry.', { retry_after: 60 }));
        return;
      }
    } catch {
      res.status(503).json(apiKeyError('rate_limiter_unavailable', 'Rate-limiter check failed on the server. Try again shortly.'));
      return;
    }

    // Touch last_used_at on api_keys
    void fetch(`${supabaseUrl}/rest/v1/api_keys?id=eq.${keyId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ last_used_at: new Date().toISOString() }),
    }).catch(() => {});

    // Lookup user's stored cTrader refresh token from user_ctrader_tokens or service_config
    let userRefreshToken = '';
    const tokenQueryRes = await fetch(`${supabaseUrl}/rest/v1/user_ctrader_tokens?user_id=eq.${authenticatedUserId}&select=refresh_token,default_account_id,is_demo`, {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
    });
    if (tokenQueryRes.ok) {
      const tokenRows = await tokenQueryRes.json().catch(() => []);
      const userTokens = Array.isArray(tokenRows) ? tokenRows[0] : null;
      if (userTokens?.refresh_token) {
        userRefreshToken = userTokens.refresh_token;
        defaultAccountId = userTokens.default_account_id ? Number(userTokens.default_account_id) : null;
        defaultIsDemo = userTokens.is_demo !== undefined ? parseIsDemo(userTokens.is_demo, true) : true;
      }
    }

    // Fallback to service_config table
    if (!userRefreshToken) {
      const configRes = await fetch(`${supabaseUrl}/rest/v1/service_config?key=in.(ctrader_refresh_${authenticatedUserId},ctrader_service_refresh_token)&select=key,value`, {
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
        },
      });
      if (configRes.ok) {
        const rows = await configRes.json().catch(() => []);
        const userRow = rows.find((r: any) => r.key === `ctrader_refresh_${authenticatedUserId}`);
        const globalRow = rows.find((r: any) => r.key === 'ctrader_service_refresh_token');
        userRefreshToken = userRow?.value || globalRow?.value || '';
      }
    }

    if (!userRefreshToken) {
      res.status(400).json({
        error: 'ctrader_not_connected',
        message: 'Your JFX API key is valid, but your cTrader account has not been connected yet. Please connect cTrader once on the Connect & Import page in the web app.',
      });
      return;
    }

    const mintAndPersist = async (refreshToken: string) => {
      const minted = await mintAccessToken(clientId, clientSecret, refreshToken);
      if (minted.refreshToken && authenticatedUserId) {
        await persistRotatedCtraderToken({
          supabaseUrl, serviceKey,
          userId: authenticatedUserId,
          newRefreshToken: minted.refreshToken,
          previousToken: refreshToken,
        });
      }
      return minted.accessToken;
    };

    try {
      accessToken = await mintAndPersist(userRefreshToken);
    } catch (err: any) {
      const msg = err?.message || '';
      // If per-user token is stale/expired/revoked, try global service token as fallback
      if (isFallbackWorthyCtraderError(msg)) {
        try {
          const svcRes = await fetch(`${supabaseUrl}/rest/v1/service_config?key=eq.ctrader_service_refresh_token&select=value`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
          const svcRows: any = await svcRes.json().catch(() => []);
          const svcToken = Array.isArray(svcRows) ? svcRows[0]?.value : svcRows?.value;
          if (svcToken && svcToken !== userRefreshToken) {
            console.log('[trade] per-user token failed, trying service token fallback');
            accessToken = await mintAndPersist(String(svcToken));
          } else throw err;
        } catch (e2: any) {
          res.status(502).json(apiKeyError('ctrader_auth_failed', `Failed to authenticate with cTrader: ${msg || e2?.message || 'Invalid session'}. Please reconnect cTrader on the Connect & Import page.`));
          return;
        }
      } else {
        res.status(502).json(apiKeyError('ctrader_auth_failed', `Failed to authenticate with cTrader: ${msg || 'Invalid session'}. Please reconnect cTrader on the Connect & Import page.`));
        return;
      }
    }
  } else if (rawKey) {
    // Direct cTrader access token (backward compat for callers not on JFX keys)
    accessToken = rawKey;
  } else {
    res.status(401).json(apiKeyError('missing_api_key', 'Missing X-API-Key or Authorization header. Send X-API-Key: jfx_pat_... or Authorization: Bearer jfx_pat_...'));
    return;
  }
  } catch (e: any) {
    console.error('[trade] auth error', e);
    if (!res.headersSent) res.status(500).json(apiKeyError('auth_failed', e?.message || String(e)));
    return;
  }

  const requestedAccountId = Number(body.ctidTraderAccountId || req.query.ctidTraderAccountId || defaultAccountId) || null;
  // NB: parseIsDemo handles string "false" correctly (Boolean("false") === true bug fix).
  const isDemo = parseIsDemo(body.isDemo !== undefined ? body.isDemo : req.query.isDemo, defaultIsDemo);
  const host = isDemo ? 'demo.ctraderapi.com' : 'live.ctraderapi.com';
  let accountId: number | null = requestedAccountId;

  let session: WsSession | null = null;

  const auditLog = async (status: number) => {
    if (keyId && authenticatedUserId && supabaseUrl && serviceKey) {
      void fetch(`${supabaseUrl}/rest/v1/api_key_audit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          key_id: keyId,
          user_id: authenticatedUserId,
          method: req.method,
          path: '/api/ctrader/trade',
          status,
          duration_ms: Date.now() - startTime,
          user_agent: req.headers['user-agent'] || 'AI Agent',
        }),
      }).catch(() => {});
    }
  };

  try {
    // Resolve the account demo/live-aware: prefer the requested/default id, but
    // self-heal when it lives on the other host (prevents "Cannot route request").
    let accounts: Array<any> = [];
    try {
      const probe = await openCtraderSession(host, clientId, clientSecret, 0, accessToken);
      const accListRes = await probe.send(PT.GET_ACCOUNTS_BY_TOKEN_REQ, { accessToken });
      probe.close();
      accounts = (accListRes.ctidTraderAccount || []) as Array<{ ctidTraderAccountId: number; isLive?: boolean; [k: string]: any }>;
      if (accounts.length === 0 && !accountId) {
        await auditLog(400);
        res.status(400).json(apiKeyError('no_ctrader_accounts', 'No cTrader accounts found for this user token.'));
        return;
      }
      if (!accountId) {
        accountId = chooseCtraderAccount(accounts, isDemo, null).accountId || null;
      } else {
        const target = accounts.find((a) => Number(a.ctidTraderAccountId) === Number(accountId));
        if (target && typeof target.isLive === 'boolean' && (isDemo ? target.isLive : !target.isLive)) {
          const alt = findAltAccountForHost(accounts, isDemo, Number(accountId));
          if (alt) accountId = Number(alt.ctidTraderAccountId);
        }
      }
    } catch {
      // Non-fatal: fall through and let the authenticated session surface the error.
    }

    if (action === 'get_accounts' || action === 'accounts') {
      await auditLog(200);
      res.status(200).json({
        ok: true,
        defaultAccountId: accountId,
        isDemo,
        accounts: accounts.map((a: any) => ({
          accountId: Number(a.ctidTraderAccountId),
          traderLogin: a.traderLogin ? Number(a.traderLogin) : undefined,
          broker: a.brokerTitleShort || a.brokerName || a.server || undefined,
          isLive: Boolean(a.isLive),
          isDemo: !a.isLive,
        })),
      });
      return;
    }

    if (action === 'check_auth' || action === 'auth_status') {
      await auditLog(200);
      res.status(200).json({
        ok: true,
        message: 'cTrader credentials and API key authentication valid',
        accountId,
        isDemo,
        userId: authenticatedUserId,
      });
      return;
    }

    session = await openCtraderSession(host, clientId, clientSecret, accountId, accessToken);

    // -------------------------------------------------------------------------
    // 1. GET POSITIONS & PENDING ORDERS
    // -------------------------------------------------------------------------
    if (isReadAction) {
      const reconcile = await session.send(PT.RECONCILE_REQ, { ctidTraderAccountId: accountId });
      const rawPositions = reconcile.position || [];
      const rawOrders = reconcile.order || [];

      const positions = rawPositions.map((pos: any) => {
        const tradeData = pos.tradeData || pos;
        return {
          positionId: Number(pos.positionId),
          symbol: tradeData.symbolName || tradeData.symbol || String(tradeData.symbolId || ''),
          symbolId: Number(tradeData.symbolId),
          volumeLots: Number(tradeData.volume ?? 0) / 10000000,
          tradeSide: tradeData.tradeSide === 1 ? 'buy' : 'sell',
          openPrice: Number(pos.price ?? tradeData.openPrice ?? 0),
          currentPrice: Number(pos.currentPrice ?? 0),
          profit: Number(pos.profit ?? 0) / 100,
          stopLoss: pos.stopLoss ? Number(pos.stopLoss) : null,
          takeProfit: pos.takeProfit ? Number(pos.takeProfit) : null,
          openTimestamp: new Date(Number(tradeData.openTimestamp ?? Date.now())).toISOString(),
        };
      });

      const orders = rawOrders.map((ord: any) => ({
        orderId: Number(ord.orderId),
        symbol: ord.symbolName || ord.symbol || String(ord.symbolId || ''),
        symbolId: Number(ord.symbolId),
        volumeLots: Number(ord.volume ?? 0) / 10000000,
        tradeSide: ord.tradeSide === 1 ? 'buy' : 'sell',
        orderType: ord.orderType === 1 ? 'market' : ord.orderType === 2 ? 'limit' : ord.orderType === 3 ? 'stop' : 'stop_limit',
        limitPrice: ord.limitPrice ? Number(ord.limitPrice) : null,
        stopPrice: ord.stopPrice ? Number(ord.stopPrice) : null,
        stopLoss: ord.stopLoss ? Number(ord.stopLoss) : null,
        takeProfit: ord.takeProfit ? Number(ord.takeProfit) : null,
      }));

      session.close();
      await auditLog(200);
      res.status(200).json({ ok: true, accountId, isDemo, positions, orders });
      return;
    }

    // -------------------------------------------------------------------------
    // 2. OPEN NEW ORDER (aliases: buy/sell also accepted for agent ergonomics)
    // -------------------------------------------------------------------------
    if (action === 'open' || action === 'new_order' || action === 'order' || action === 'buy' || action === 'sell') {
      // If action itself is buy/sell and no side specified, infer side from action
      if ((action === 'buy' || action === 'sell') && !body.side && !body.tradeSide) {
        (body as any).side = action;
      }
      // Alias common field names agents use
      const rawSymbol = body.symbol || body.pair || body.instrument || body.ticker;
      let symbolId = Number(body.symbolId);

      if (!symbolId && rawSymbol) {
        const symbolsRes = await session.send(PT.SYMBOLS_LIST_REQ, { ctidTraderAccountId: accountId });
        const cleanName = String(rawSymbol).toUpperCase().replace(/[^A-Z0-9]/g, '');
        const match = (symbolsRes.symbol || []).find((s: any) => {
          const sName = String(s.symbolName || s.name || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
          return sName === cleanName || sName.includes(cleanName);
        });
        if (match?.symbolId) {
          symbolId = Number(match.symbolId);
        } else {
          session.close();
          await auditLog(400);
          res.status(400).json({ error: `Symbol '${rawSymbol}' not found on account ${accountId}` });
          return;
        }
      }

      if (!symbolId) {
        session.close();
        await auditLog(400);
        res.status(400).json({ error: 'Missing symbol or symbolId' });
        return;
      }

      const rawSide = String(body.side || body.tradeSide || 'buy').toLowerCase();
      const tradeSide = rawSide === 'sell' ? 2 : 1;
      const rawType = String(body.orderType || 'market').toLowerCase();
      let orderType = 1;
      if (rawType === 'limit') orderType = 2;
      else if (rawType === 'stop') orderType = 3;
      else if (rawType === 'stop_limit') orderType = 4;

      const volumeLots = Number(body.volume || body.volumeLots || 0.01);
      const volumeCents = toVolumeCents(volumeLots);

      const payload: Record<string, any> = {
        ctidTraderAccountId: accountId,
        symbolId,
        orderType,
        tradeSide,
        volume: volumeCents,
      };

      if (body.limitPrice) payload.limitPrice = Number(body.limitPrice);
      if (body.stopPrice) payload.stopPrice = Number(body.stopPrice);
      if (body.stopLoss) payload.stopLoss = Number(body.stopLoss);
      if (body.takeProfit) payload.takeProfit = Number(body.takeProfit);
      if (body.comment) payload.comment = String(body.comment);

      const result = await session.send(PT.NEW_ORDER_REQ, payload);
      session.close();
      await auditLog(200);
      res.status(200).json({ ok: true, message: 'Order submitted', accountId, isDemo, result });
      return;
    }

    // -------------------------------------------------------------------------
    // 3. CLOSE POSITION & CLOSE ALL
    // -------------------------------------------------------------------------
    if (action === 'close_all') {
      const rec = await session.send(PT.RECONCILE_REQ, { ctidTraderAccountId: accountId });
      const positions = rec.position || [];
      const closed: any[] = [];
      const errors: any[] = [];
      for (const pos of positions) {
        const pId = Number(pos.positionId);
        const vol = Number(pos?.tradeData?.volume || pos?.volume || 10000000);
        try {
          const closeRes = await session.send(PT.CLOSE_POSITION_REQ, {
            ctidTraderAccountId: accountId,
            positionId: pId,
            volume: vol,
          });
          closed.push({ positionId: pId, result: closeRes });
        } catch (err: any) {
          errors.push({ positionId: pId, error: err?.message || String(err) });
        }
      }
      session.close();
      await auditLog(200);
      res.status(200).json({ ok: true, message: `Closed ${closed.length} position(s)`, closedCount: closed.length, closed, errors });
      return;
    }

    if (action === 'close' || action === 'close_position') {
      const positionId = Number(body.positionId);
      if (!positionId) {
        session.close();
        await auditLog(400);
        res.status(400).json({ error: 'Missing positionId' });
        return;
      }

      let volumeCents: number;
      if (body.volume || body.volumeLots) {
        volumeCents = toVolumeCents(Number(body.volume || body.volumeLots));
      } else {
        const rec = await session.send(PT.RECONCILE_REQ, { ctidTraderAccountId: accountId });
        const pos = (rec.position || []).find((p: any) => Number(p.positionId) === positionId);
        volumeCents = Number(pos?.tradeData?.volume || pos?.volume || 10000000);
      }

      const result = await session.send(PT.CLOSE_POSITION_REQ, {
        ctidTraderAccountId: accountId,
        positionId,
        volume: volumeCents,
      });

      session.close();
      await auditLog(200);
      res.status(200).json({ ok: true, message: 'Position closed', result });
      return;
    }

    // -------------------------------------------------------------------------
    // 4. MODIFY POSITION SL / TP
    // -------------------------------------------------------------------------
    if (action === 'modify_position' || action === 'modify_sltp') {
      const positionId = Number(body.positionId);
      if (!positionId) {
        session.close();
        await auditLog(400);
        res.status(400).json({ error: 'Missing positionId' });
        return;
      }

      const payload: Record<string, any> = {
        ctidTraderAccountId: accountId,
        positionId,
        guaranteedStopLoss: false,
      };

      if (body.stopLoss !== undefined) payload.stopLoss = Number(body.stopLoss);
      if (body.takeProfit !== undefined) payload.takeProfit = Number(body.takeProfit);

      const result = await session.send(PT.AMEND_POSITION_SLTP_REQ, payload);
      session.close();
      await auditLog(200);
      res.status(200).json({ ok: true, message: 'Position SL/TP modified', result });
      return;
    }

    // -------------------------------------------------------------------------
    // 5. MODIFY PENDING ORDER
    // -------------------------------------------------------------------------
    if (action === 'modify_order' || action === 'amend_order') {
      const orderId = Number(body.orderId);
      if (!orderId) {
        session.close();
        await auditLog(400);
        res.status(400).json({ error: 'Missing orderId' });
        return;
      }

      const payload: Record<string, any> = {
        ctidTraderAccountId: accountId,
        orderId,
      };

      if (body.volume || body.volumeLots) payload.volume = toVolumeCents(Number(body.volume || body.volumeLots));
      if (body.limitPrice) payload.limitPrice = Number(body.limitPrice);
      if (body.stopPrice) payload.stopPrice = Number(body.stopPrice);
      if (body.stopLoss !== undefined) payload.stopLoss = Number(body.stopLoss);
      if (body.takeProfit !== undefined) payload.takeProfit = Number(body.takeProfit);

      const result = await session.send(PT.AMEND_ORDER_REQ, payload);
      session.close();
      await auditLog(200);
      res.status(200).json({ ok: true, message: 'Pending order modified', result });
      return;
    }

    // -------------------------------------------------------------------------
    // 6. CANCEL PENDING ORDER
    // -------------------------------------------------------------------------
    if (action === 'cancel_order' || action === 'cancel') {
      const orderId = Number(body.orderId);
      if (!orderId) {
        session.close();
        await auditLog(400);
        res.status(400).json({ error: 'Missing orderId' });
        return;
      }

      const result = await session.send(PT.CANCEL_ORDER_REQ, {
        ctidTraderAccountId: accountId,
        orderId,
      });

      session.close();
      await auditLog(200);
      res.status(200).json({ ok: true, message: 'Pending order cancelled', result });
      return;
    }

    session.close();
    await auditLog(400);
    res.status(400).json({ error: `Unknown action '${action}'` });
  } catch (err: any) {
    if (session) session.close();
    await auditLog(500);
    res.status(500).json({ error: err?.message || 'Trading request failed' });
  }
}
