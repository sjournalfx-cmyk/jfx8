import type { VercelRequest, VercelResponse } from '@vercel/node';
import WebSocket from 'ws';
import { createHash } from 'crypto';

const CTRADER_TOKEN_URL = 'https://openapi.ctrader.com/apps/token';
const TOKEN_PATTERN = /^jfx_pat_[a-z0-9]{8}_[A-Za-z0-9]{32}$/;

function getCredentials() {
  return {
    clientId: process.env.CTRADER_CLIENT_ID || process.env.VITE_CTRADER_CLIENT_ID || '',
    clientSecret: process.env.CTRADER_CLIENT_SECRET || process.env.VITE_CTRADER_CLIENT_SECRET || '',
    supabaseUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
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

const CTRADER_VOLUME_CENTS_PER_LOT = 10000000;
const CTRADER_VOLUME_CENTS_PER_UNIT = 100;

function toVolumeCents(volume: number): number {
  if (volume >= 500) {
    return Math.round(volume * CTRADER_VOLUME_CENTS_PER_UNIT);
  }
  return Math.round(volume * CTRADER_VOLUME_CENTS_PER_LOT);
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
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
 * Mint a fresh cTrader access token from the refresh token stored in DB or cookie.
 */
async function mintAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  userId?: string,
  supabaseUrl?: string,
  serviceKey?: string,
): Promise<string> {
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

  // Update rotated refresh token in DB if new one returned
  if (body.refreshToken && userId && supabaseUrl && serviceKey) {
    void fetch(`${supabaseUrl}/rest/v1/user_ctrader_tokens?user_id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        refresh_token: String(body.refreshToken),
        updated_at: new Date().toISOString(),
      }),
    }).catch(() => {});
  }

  return String(body.accessToken);
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

  const authHeader = (req.headers['authorization'] || req.headers['x-api-key'] || req.headers['x-access-token'] || '') as string;
  const rawKey = authHeader.replace(/^Bearer\s+/i, '').trim();

  const body = (typeof req.body === 'object' && req.body !== null) ? req.body : {};
  const action = String(body.action || req.query.action || (req.method === 'GET' ? 'get_positions' : 'open')).toLowerCase();
  const isReadAction = action === 'get_positions' || action === 'positions' || req.method === 'GET';

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
  if (TOKEN_PATTERN.test(rawKey)) {
    if (!supabaseUrl || !serviceKey) {
      res.status(503).json({ error: 'Database service not configured' });
      return;
    }

    const keyHash = hashToken(rawKey);
    const keyQueryRes = await fetch(`${supabaseUrl}/rest/v1/api_keys?key_hash=eq.${keyHash}&select=id,user_id,scopes,expires_at`, {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
    });

    const keyRows = await keyQueryRes.json().catch(() => []);
    const apiKey = Array.isArray(keyRows) ? keyRows[0] : null;

    if (!apiKey) {
      res.status(401).json({ error: 'invalid_api_key' });
      return;
    }

    if (apiKey.expires_at && new Date(apiKey.expires_at).getTime() <= Date.now()) {
      res.status(401).json({ error: 'expired_api_key' });
      return;
    }

    const scopes: string[] = apiKey.scopes || [];
    const requiredScope = isReadAction ? 'trades:read' : 'trades:write';
    if (!scopes.includes(requiredScope) && !scopes.includes('trades:write')) {
      res.status(403).json({ error: 'insufficient_scope', need: requiredScope, have: scopes, hint: requiredScope === 'trades:write' ? 'Recreate the key in Settings → Developer Tools with trades:write enabled' : 'Requires trades:read (or trades:write)' });
      return;
    }

    authenticatedUserId = apiKey.user_id;
    keyId = apiKey.id;

    // Rate limiting check via consume_api_key_rate_limit RPC
    const rateLimitRes = await fetch(`${supabaseUrl}/rest/v1/rpc/consume_api_key_rate_limit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ p_user_id: authenticatedUserId, p_key_id: keyId }),
    });
    const allowed = await rateLimitRes.json().catch(() => true);
    if (allowed === false) {
      res.setHeader('Retry-After', '60');
      res.status(429).json({ error: 'rate_limited', retry_after: 60 });
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
        defaultIsDemo = userTokens.is_demo !== undefined ? Boolean(userTokens.is_demo) : true;
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

    try {
      accessToken = await mintAccessToken(clientId, clientSecret, userRefreshToken, authenticatedUserId, supabaseUrl, serviceKey);
    } catch (err: any) {
      res.status(502).json({
        error: 'ctrader_auth_failed',
        message: `Failed to authenticate with cTrader: ${err?.message || 'Invalid session'}. Please reconnect cTrader on the Connect & Import page.`,
      });
      return;
    }
  } else if (rawKey) {
    // Direct cTrader access token
    accessToken = rawKey;
  } else {
    res.status(401).json({ error: 'Missing X-API-Key or Authorization header' });
    return;
  }

  let accountId = Number(body.ctidTraderAccountId || req.query.ctidTraderAccountId || defaultAccountId);
  const isDemo = body.isDemo !== undefined ? Boolean(body.isDemo) : (req.query.isDemo !== undefined ? req.query.isDemo === 'true' : defaultIsDemo);
  const host = isDemo ? 'demo.ctraderapi.com' : 'live.ctraderapi.com';

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
    // If accountId is not provided, query cTrader for the user's accounts
    if (!accountId) {
      session = await openCtraderSession(host, clientId, clientSecret, 0, accessToken);
      const accListRes = await session.send(PT.GET_ACCOUNTS_BY_TOKEN_REQ, { accessToken });
      const accounts = accListRes.ctidTraderAccount || [];
      if (accounts.length === 0) {
        session.close();
        await auditLog(400);
        res.status(400).json({ error: 'No cTrader accounts found for this user' });
        return;
      }
      accountId = Number(accounts[0].ctidTraderAccountId);
      session.close();
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
    // 3. CLOSE POSITION
    // -------------------------------------------------------------------------
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
