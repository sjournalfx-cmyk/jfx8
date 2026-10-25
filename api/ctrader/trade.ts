import type { VercelRequest, VercelResponse } from '@vercel/node';
import WebSocket from 'ws';
import { createHash } from 'crypto';
import { requireUser } from '../_lib/auth.js';
import { setCtraderRefreshLease } from '../_lib/ctraderTokenLock.js';
import logoutHandler from '../_lib/logoutHandler.js';
import candlesHandler from '../_lib/candlesHandler.js';
import {
  hashOrderParams,
  resolveSymbolId,
  suggestSymbols,
} from '../_lib/apiKeys.js';
import {
  countOpensToday,
  evaluateLocks,
  getUserTimezone,
  isRuleActive,
  normalizeLocks,
  resolvePortfolioContext,
  toLots,
  unlockMsRemaining,
  type PortfolioContext,
} from '../_lib/tradingLocks.js';
import {
  extractRawApiKey,
  isJfxApiKey,
  parseIsDemo,
  hasTradeScope,
  toVolumeCents,
  chooseCtraderAccount,
  findAltAccountForHost,
  apiKeyError,
  persistRotatedCtraderToken,
} from '../_lib/jfxApiKey.js';

const CTRADER_TOKEN_URL = 'https://openapi.ctrader.com/apps/token';

function getCredentials() {
  return {
    clientId: (process.env.CTRADER_CLIENT_ID || '').trim(),
    clientSecret: (process.env.CTRADER_CLIENT_SECRET || '').trim(),
    supabaseUrl: (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, ''),
    serviceKey: (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
  };
}

export const PT = {
  APPLICATION_AUTH_REQ: 2100,
  ACCOUNT_AUTH_REQ: 2102,
  NEW_ORDER_REQ: 2106,
  CANCEL_ORDER_REQ: 2108,
  AMEND_ORDER_REQ: 2109,
  AMEND_POSITION_SLTP_REQ: 2110,
  CLOSE_POSITION_REQ: 2111,
  ASSET_LIST_REQ: 2112,
  SYMBOLS_LIST_REQ: 2114,
  SYMBOL_BY_ID_REQ: 2116,
  SYMBOLS_FOR_CONVERSION_REQ: 2118,
  TRADER_REQ: 2121,
  RECONCILE_REQ: 2124,
  SUBSCRIBE_SPOTS_REQ: 2127,
  UNSUBSCRIBE_SPOTS_REQ: 2129,
  DEAL_LIST_REQ: 2133,
  GET_TRENDBARS_REQ: 2137,
  EXPECTED_MARGIN_REQ: 2139,
  CASH_FLOW_HISTORY_LIST_REQ: 2143,
  GET_TICKDATA_REQ: 2145,
  GET_ACCOUNTS_BY_TOKEN_REQ: 2149,
  GET_CTID_PROFILE_BY_TOKEN_REQ: 2151,
  ASSET_CLASS_LIST_REQ: 2153,
  SYMBOL_CATEGORY_REQ: 2160,
  MARGIN_CALL_LIST_REQ: 2167,
  ORDER_LIST_REQ: 2175,
  GET_DYNAMIC_LEVERAGE_REQ: 2177,
  DEAL_LIST_BY_POSITION_ID_REQ: 2179,
  ORDER_DETAILS_REQ: 2181,
  ORDER_LIST_BY_POSITION_ID_REQ: 2183,
  DEAL_OFFSET_LIST_REQ: 2185,
  GET_POSITION_UNREALIZED_PNL_REQ: 2187,
  ERROR_RES: 2142,
};

// One-shot reads the web terminal may request through the `proxy` action. The
// server still supplies credentials and forcibly overwrites
// ctidTraderAccountId below, so these cannot target another account.
export const BROWSER_PROXY_PAYLOAD_TYPES = new Set<number>([
  PT.SYMBOLS_LIST_REQ,
  PT.SYMBOL_BY_ID_REQ,
  PT.SYMBOLS_FOR_CONVERSION_REQ,
  PT.ASSET_LIST_REQ,
  PT.ASSET_CLASS_LIST_REQ,
  PT.SYMBOL_CATEGORY_REQ,
  PT.TRADER_REQ,
  PT.RECONCILE_REQ,
  PT.DEAL_LIST_REQ,
  PT.ORDER_LIST_REQ,
  PT.DEAL_LIST_BY_POSITION_ID_REQ,
  PT.ORDER_LIST_BY_POSITION_ID_REQ,
  PT.ORDER_DETAILS_REQ,
  PT.DEAL_OFFSET_LIST_REQ,
  PT.MARGIN_CALL_LIST_REQ,
  PT.GET_DYNAMIC_LEVERAGE_REQ,
  PT.GET_POSITION_UNREALIZED_PNL_REQ,
  PT.GET_TRENDBARS_REQ,
  PT.GET_TICKDATA_REQ,
  PT.EXPECTED_MARGIN_REQ,
  PT.CASH_FLOW_HISTORY_LIST_REQ,
  PT.GET_CTID_PROFILE_BY_TOKEN_REQ,
  PT.NEW_ORDER_REQ,
  PT.CANCEL_ORDER_REQ,
  PT.AMEND_ORDER_REQ,
  PT.AMEND_POSITION_SLTP_REQ,
  PT.CLOSE_POSITION_REQ,
]);

function hashToken(raw: string): string {
  try { return createHash('sha256').update(raw).digest('hex'); } catch (e: any) {
    // Fallback: simple hex via Buffer if crypto fails (should not happen)
    console.error('[trade] createHash failed', e?.message);
    throw new Error('hash_failed: ' + (e?.message || String(e)));
  }
}

interface WsSession {
  send: (payloadType: number, payload: Record<string, any>) => Promise<any>;
  onEvent: (listener: (payloadType: number, payload: Record<string, any>) => void) => () => void;
  heartbeat: () => void;
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
    const eventListeners = new Set<(payloadType: number, payload: Record<string, any>) => void>();

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
        for (const listener of eventListeners) {
          try { listener(Number(msg.payloadType), msg.payload || {}); } catch { /* listener isolation */ }
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
          onEvent: (listener) => {
            eventListeners.add(listener);
            return () => eventListeners.delete(listener);
          },
          heartbeat: () => {
            if (ws.readyState === WebSocket.OPEN) {
              try { ws.send(JSON.stringify({ clientMsgId: `heartbeat_${Date.now()}`, payloadType: 51, payload: {} })); } catch {}
            }
          },
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
): Promise<{ accessToken: string; refreshToken: string | null; expiresInSeconds: number }> {
  const tokenUrl = new URL(CTRADER_TOKEN_URL);
  tokenUrl.searchParams.set('grant_type', 'refresh_token');
  tokenUrl.searchParams.set('refresh_token', refreshToken);
  tokenUrl.searchParams.set('client_id', clientId);
  tokenUrl.searchParams.set('client_secret', clientSecret);

  // Bound the mint (see refresh.ts): an unbounded fetch that hangs until the
  // invocation is killed orphans the refresh lease with no clean failure.
  const res = await fetch(tokenUrl.toString(), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(25000),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.errorCode || !body.accessToken) {
    const msg = body.description || body.errorCode || `cTrader refresh failed (HTTP ${res.status})`;
    throw new Error(msg);
  }

  return {
    accessToken: String(body.accessToken),
    refreshToken: body.refreshToken ? String(body.refreshToken) : null,
    expiresInSeconds: Number.isFinite(Number(body.expiresIn || body.expires_in))
      ? Math.max(60, Number(body.expiresIn || body.expires_in))
      : 300,
  };
}

async function loadUserCtraderAccessToken({
  supabaseUrl,
  serviceKey,
  clientId,
  clientSecret,
  userId,
}: {
  supabaseUrl: string;
  serviceKey: string;
  clientId: string;
  clientSecret: string;
  userId: string;
}): Promise<{ accessToken: string; defaultAccountId: number | null; defaultIsDemo: boolean } | null> {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  type StoredToken = {
    refresh_token?: string;
    default_account_id?: number | string | null;
    is_demo?: boolean | string | null;
    access_token?: string | null;
    access_token_expires_at?: string | null;
  };
  const loadStoredToken = async (): Promise<StoredToken | null> => {
    const response = await fetch(`${supabaseUrl}/rest/v1/user_ctrader_tokens?user_id=eq.${userId}&select=refresh_token,default_account_id,is_demo,access_token,access_token_expires_at`, { headers });
    if (!response.ok) throw new Error('ctrader_token_store_unavailable');
    const rows = await response.json().catch(() => []);
    return Array.isArray(rows) ? rows[0] || null : null;
  };
  const cacheIsValid = (stored: StoredToken | null) => {
    const expiresAt = stored?.access_token_expires_at ? Date.parse(stored.access_token_expires_at) : Number.NaN;
    return Boolean(stored?.access_token && Number.isFinite(expiresAt) && expiresAt > Date.now() + 60_000);
  };

  let stored = await loadStoredToken();
  if (cacheIsValid(stored)) {
    return {
      accessToken: String(stored!.access_token),
      defaultAccountId: stored!.default_account_id ? Number(stored!.default_account_id) : null,
      defaultIsDemo: stored!.is_demo !== undefined ? parseIsDemo(stored!.is_demo, true) : true,
    };
  }

  const leaseAcquired = await setCtraderRefreshLease(supabaseUrl, serviceKey, userId, true);
  if (!leaseAcquired) throw new Error('ctrader_refresh_in_progress');

  try {
    // Read after acquiring the lease so a caller that waited behind another
    // rotation uses the replacement token rather than the stale one.
    stored = await loadStoredToken();
    if (cacheIsValid(stored)) {
      return {
        accessToken: String(stored!.access_token),
        defaultAccountId: stored!.default_account_id ? Number(stored!.default_account_id) : null,
        defaultIsDemo: stored!.is_demo !== undefined ? parseIsDemo(stored!.is_demo, true) : true,
      };
    }

    let refreshToken = stored?.refresh_token ? String(stored.refresh_token) : '';
    const defaultAccountId = stored?.default_account_id ? Number(stored.default_account_id) : null;
    const defaultIsDemo = stored?.is_demo !== undefined ? parseIsDemo(stored.is_demo, true) : true;

    // Support the pre-token-table, per-user storage key during migration. A
    // global service token must never be used for a different user's account.
    if (!refreshToken) {
      const legacyRes = await fetch(`${supabaseUrl}/rest/v1/service_config?key=eq.ctrader_refresh_${userId}&select=value`, { headers });
      if (legacyRes.ok) {
        const rows = await legacyRes.json().catch(() => []);
        refreshToken = Array.isArray(rows) ? String(rows[0]?.value || '') : '';
      }
    }

    if (!refreshToken) return null;

    const minted = await mintAccessToken(clientId, clientSecret, refreshToken);
    if (!minted.refreshToken) throw new Error('cTrader did not return a replacement refresh token.');
    await persistRotatedCtraderToken({
      supabaseUrl,
      serviceKey,
      userId,
      newRefreshToken: minted.refreshToken,
      previousToken: refreshToken,
      newAccessToken: minted.accessToken,
      accessTokenExpiresAt: new Date(Date.now() + minted.expiresInSeconds * 1000).toISOString(),
    });

    return { accessToken: minted.accessToken, defaultAccountId, defaultIsDemo };
  } finally {
    await setCtraderRefreshLease(supabaseUrl, serviceKey, userId, false).catch(() => undefined);
  }
}

async function recordLockBlock(
  deps: { supabaseUrl: string; serviceKey: string },
  userId: string,
  portfolioId: string,
  rule: string
): Promise<void> {
  try {
    await fetch(`${deps.supabaseUrl}/rest/v1/lock_blocks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: deps.serviceKey,
        Authorization: `Bearer ${deps.serviceKey}`,
      },
      body: JSON.stringify({ user_id: userId, portfolio_id: portfolioId, rule }),
      signal: AbortSignal.timeout(2500),
    });
  } catch (e: any) {
    // Never let block telemetry break the actual 403 response.
    console.warn('[trade] lock block record failed:', e?.message);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const startTime = Date.now();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, X-Access-Token, Idempotency-Key');

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

  // Candles is a read-only GET sub-route. Dispatch it before any body
  // parsing / POST-only handling so `/api/ctrader/candles` (vercel.json
  // rewrite -> `?action=candles`) and the legacy alias both work.
  if (String(req.query.action || '').toLowerCase() === 'candles') {
    return candlesHandler(req, res);
  }

  const body = (typeof req.body === 'object' && req.body !== null) ? req.body : {};
  const action = String(body.action || req.query.action || (req.method === 'GET' ? 'get_positions' : 'open')).toLowerCase();

  // Delegated sub-routes.
  //
  // Vercel's Hobby plan caps a deployment at 12 Serverless Functions, so these
  // two used to be standalone files (api/ctrader/logout, api/ctrader/candles)
  // and the build failed with `exceeded_serverless_functions_per_deployment`.
  // Their handlers now live in api/_lib/ (underscore = not a route) and are
  // dispatched from here, so the public surface is unchanged:
  //   POST /api/ctrader/trade?action=logout
  //   GET  /api/ctrader/trade?action=candles&symbol=EURUSD&timeframe=H1
  // Both must run BEFORE any broker session is opened — logout needs no
  // broker at all, and candles manages its own auth and connection.
  if (action === 'logout') {
    return logoutHandler(req, res);
  }
  if (action === 'candles') {
    return candlesHandler(req, res);
  }

  const isReadAction = action === 'get_positions' || action === 'positions' || action === 'get_accounts' || action === 'accounts' || action === 'check_auth' || action === 'auth_status' || req.method === 'GET';

  let accessToken = '';
  let authenticatedUserId: string | null = null;
  let keyId: string | null = null;
  let defaultAccountId: number | null = null;
  let defaultIsDemo = true;
  let isBrowserSession = false;

  // ---------------------------------------------------------------------------
  // AUTHENTICATION STRATEGY:
  // 1. Verified JFX web session -> user's server-stored cTrader credential
  // 2. JFX Personal API Key -> user's server-stored cTrader credential
  // 3. Direct cTrader access token -> backward compatibility for external tools
  // ---------------------------------------------------------------------------
  try {
  const browserAuth = isJfxApiKey(rawKey) ? null : await requireUser(req.headers);
  if (browserAuth?.ok && browserAuth.userId) {
    if (!supabaseUrl || !serviceKey) {
      res.status(503).json({ error: 'Database service not configured on server' });
      return;
    }
    const connected = await loadUserCtraderAccessToken({
      supabaseUrl, serviceKey, clientId, clientSecret, userId: browserAuth.userId,
    });
    if (!connected) {
      res.status(400).json({
        error: 'ctrader_not_connected',
        message: 'Connect cTrader before requesting account data.',
      });
      return;
    }
    accessToken = connected.accessToken;
    defaultAccountId = connected.defaultAccountId;
    defaultIsDemo = connected.defaultIsDemo;
    authenticatedUserId = browserAuth.userId;
    isBrowserSession = true;
  } else if (isJfxApiKey(rawKey)) {
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

    const connected = await loadUserCtraderAccessToken({
      supabaseUrl, serviceKey, clientId, clientSecret, userId: authenticatedUserId,
    });
    if (!connected) {
      res.status(400).json({
        error: 'ctrader_not_connected',
        message: 'Your JFX API key is valid, but your cTrader account has not been connected yet. Please connect cTrader once on the Connect & Import page in the web app.',
      });
      return;
    }
    accessToken = connected.accessToken;
    defaultAccountId = connected.defaultAccountId;
    defaultIsDemo = connected.defaultIsDemo;
  } else if (rawKey) {
    // Direct cTrader access token (backward compat for callers not on JFX keys)
    accessToken = rawKey;
  } else {
    res.status(401).json(apiKeyError('missing_api_key', 'Missing X-API-Key or Authorization header. Send X-API-Key: jfx_pat_... or Authorization: Bearer jfx_pat_...'));
    return;
  }
  } catch (e: any) {
    console.error('[trade] auth error', e);
    if (!res.headersSent && e?.message === 'ctrader_refresh_in_progress') {
      res.setHeader('Retry-After', '1');
      res.status(503).json(apiKeyError('ctrader_refresh_in_progress', 'cTrader is refreshing this account. Retry in a moment.'));
      return;
    }
    if (!res.headersSent) res.status(500).json(apiKeyError('auth_failed', e?.message || String(e)));
    return;
  }

  const requestedAccountId = Number(body.ctidTraderAccountId || req.query.ctidTraderAccountId || defaultAccountId) || null;
  // NB: parseIsDemo handles string "false" correctly (Boolean("false") === true bug fix).
  const isDemo = parseIsDemo(body.isDemo !== undefined ? body.isDemo : req.query.isDemo, defaultIsDemo);
  const host = isDemo ? 'demo.ctraderapi.com' : 'live.ctraderapi.com';
  let accountId: number | null = requestedAccountId;

  let session: WsSession | null = null;

  // Idempotency: retries with the same key + identical params replay the
  // stored result instead of opening a second position. API-key callers MUST
  // send Idempotency-Key (header or body); app sessions may omit it.
  const readIdempotencyKey = (): string => {
    const fromHeader = String((req.headers['idempotency-key'] as string) || '').trim();
    if (fromHeader) return fromHeader;
    const fromBody = String((body as any)?.idempotencyKey || '').trim();
    return fromBody;
  };

  const lookupIdempotency = async (idemKey: string): Promise<any | null> => {
    if (!supabaseUrl || !serviceKey) return null;
    try {
      const r = await fetch(
        `${supabaseUrl}/rest/v1/api_order_idempotency?idempotency_key=eq.${encodeURIComponent(idemKey)}`,
        { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
      );
      if (!r.ok) return null;
      const rows = await r.json();
      return Array.isArray(rows) && rows.length ? rows[0] : null;
    } catch {
      // Fail open: an unreachable idempotency table must not block trading.
      return null;
    }
  };

  const storeIdempotency = async (row: {
    key: string;
    user_id: string;
    account_id: number;
    params_hash: string;
    status: 'completed';
    result: unknown;
  }): Promise<void> => {
    if (!supabaseUrl || !serviceKey) return;
    try {
      await fetch(`${supabaseUrl}/rest/v1/api_order_idempotency`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Prefer: 'resolution=merge-duplicates',
        },
        body: JSON.stringify({
          idempotency_key: row.key,
          user_id: row.user_id,
          account_id: row.account_id,
          params_hash: row.params_hash,
          status: row.status,
          result: row.result,
        }),
      });
    } catch {
      // Non-fatal: the order already went through.
    }
  };

  const contextWarnings = (ctx: PortfolioContext): string[] => {
    const warnings: string[] = [];
    if (ctx.portfolioIds.length > 1) {
      warnings.push('This broker account is linked to more than one portfolio; limits come from the first match.');
    }
    if (ctx.locksUnchecked) {
      warnings.push('Trading-lock rows were unreachable for this request and were NOT enforced.');
    }
    return warnings;
  };

  const portfolioFields = (ctx: PortfolioContext) => ({
    portfolioId: ctx.portfolioId,
    portfolioName: ctx.portfolioName,
    ...(ctx.portfolioIds.length > 1 ? { portfolioIds: ctx.portfolioIds } : {}),
  });

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

    if (action === 'stream_spots') {
      if (!isBrowserSession) {
        session.close();
        await auditLog(403);
        res.status(403).json({ error: 'A signed-in web session is required for spot streaming.' });
        return;
      }
      const symbolIds = Array.isArray(body?.payload?.symbolIds)
        ? [...new Set(body.payload.symbolIds.map(Number).filter((id: number) => Number.isSafeInteger(id) && id > 0))].slice(0, 50)
        : [];
      if (symbolIds.length === 0) {
        session.close();
        await auditLog(400);
        res.status(400).json({ error: 'At least one valid symbol id is required.' });
        return;
      }

      await session.send(PT.SUBSCRIBE_SPOTS_REQ, { ctidTraderAccountId: accountId, symbolId: symbolIds });
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      const writeEvent = (event: string, payload: Record<string, any>) => {
        if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
      };
      const removeEventListener = session.onEvent((payloadType, payload) => {
        if (payloadType === 2131 && symbolIds.includes(Number(payload.symbolId))) {
          writeEvent('spot', payload);
        }
      });
      const heartbeat = setInterval(() => {
        session?.heartbeat();
        writeEvent('keepalive', {});
      }, 10_000);
      const cleanup = () => {
        clearInterval(heartbeat);
        removeEventListener();
        session?.close();
      };
      req.once('close', cleanup);
      res.once('close', cleanup);
      writeEvent('ready', { accountId, isDemo, symbolIds });
      await auditLog(200);
      return;
    }

    // The browser can request only the cTrader operations used by the UI. The
    // server supplies both protocol credentials and the account identifier, so
    // a caller cannot authenticate another account or submit arbitrary frames.
    if (action === 'proxy') {
      if (!isBrowserSession) {
        session.close();
        await auditLog(403);
        res.status(403).json({ error: 'A signed-in web session is required for proxy requests.' });
        return;
      }
      const payloadType = Number(body.payloadType);
      if (!BROWSER_PROXY_PAYLOAD_TYPES.has(payloadType)) {
        session.close();
        await auditLog(400);
        res.status(400).json({
          error: 'unsupported_browser_operation',
          message: 'This cTrader view is not available in the web terminal yet. Your account is still connected.',
          reason: 'Unsupported cTrader browser operation.',
          payloadType,
        });
        return;
      }
      if (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) {
        session.close();
        await auditLog(400);
        res.status(400).json({ error: 'A cTrader payload object is required.' });
        return;
      }

      const payload = { ...body.payload } as Record<string, any>;
      delete payload.clientId;
      delete payload.clientSecret;
      delete payload.accessToken;
      payload.ctidTraderAccountId = accountId;
      if (payloadType === PT.GET_CTID_PROFILE_BY_TOKEN_REQ) payload.accessToken = accessToken;

      const result = await session.send(payloadType, payload);
      session.close();
      await auditLog(200);
      res.status(200).json({ ok: true, accountId, isDemo, result });
      return;
    }

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
        // Exact broker listing wins over fuzzy matches (EURUSD must not
        // resolve to EURUSDm when EURUSD exists). See api/_lib/apiKeys.ts.
        const resolved = resolveSymbolId(symbolsRes.symbol || [], rawSymbol);
        if (resolved) {
          symbolId = Number(resolved.symbolId);
        } else {
          const suggestions = suggestSymbols(symbolsRes.symbol || [], rawSymbol);
          session.close();
          await auditLog(400);
          res.status(400).json({
            error: `Symbol '${rawSymbol}' not found on account ${accountId}`,
            ...(suggestions.length > 0 ? { suggestions } : {}),
          });
          return;
        }
      }

      if (!symbolId) {
        session.close();
        await auditLog(400);
        res.status(400).json({ error: 'Missing symbol or symbolId' });
        return;
      }

      // Trading locks: portfolio hard limits bind every new-risk order path
      // (agents, PATs, apps). Closes/modifies are never gated. Unlinked
      // accounts warn-but-allow; unreachable lock rows warn-but-allow;
      // skipped entirely for raw-token calls (no user).
      let portfolioCtx: PortfolioContext | null = null;
      if (authenticatedUserId && supabaseUrl && serviceKey) {
        try {
          const deps = { supabaseUrl, serviceKey };
          portfolioCtx = await resolvePortfolioContext(deps, authenticatedUserId, accountId!);
          const locks = normalizeLocks(portfolioCtx.locks);
          if (portfolioCtx.portfolioId && locks) {
            const volumeLotsForLocks = toLots(body.volume ?? body.volumeLots ?? 0.01);
            // null means "could not confirm" — never treat that as zero fills.
            let fillsToday: number | null = 0;
            let tz: string | undefined;
            if (isRuleActive(locks.maxTrades)) {
              tz = await getUserTimezone(deps, authenticatedUserId);
              fillsToday = await countOpensToday(session, accountId!, tz);
            }
            const verdict = evaluateLocks(locks, { symbolId, volumeLots: volumeLotsForLocks, fillsToday, timezone: tz });
            if (verdict.allowed === false) {
              const context: Record<string, unknown> = {};
              if (verdict.rule === 'pairWhitelist') {
                context.allowedSymbolIds = (locks.pairWhitelist?.symbolIds || []).map(Number);
              } else if (verdict.rule === 'maxTrades') {
                if (fillsToday === null) {
                  context.reason = 'count_unavailable';
                } else {
                  const max = Math.max(1, Math.floor(Number(locks.maxTrades?.maxPerDay) || 1));
                  context.maxPerDay = max;
                  context.fillsToday = fillsToday;
                }
              } else {
                if (locks.lotGuard?.minLots !== undefined) context.minLots = Number(locks.lotGuard.minLots);
                if (locks.lotGuard?.maxLots !== undefined) context.maxLots = Number(locks.lotGuard.maxLots);
                context.volumeLots = volumeLotsForLocks;
              }
              const cooldownMsRemaining = Math.max(
                0,
                unlockMsRemaining(locks[verdict.rule]?.unlockRequestedAt ?? null)
              );
              await recordLockBlock(deps, authenticatedUserId, portfolioCtx.portfolioId, verdict.rule);
              session.close();
              await auditLog(403);
              res.status(403).json({
                ok: false,
                error: 'locked_by_rule',
                rule: verdict.rule,
                message: verdict.message,
                portfolioId: portfolioCtx.portfolioId,
                portfolioName: portfolioCtx.portfolioName,
                accountId,
                isDemo,
                context,
                ...(cooldownMsRemaining > 0 ? { cooldownMsRemaining } : {}),
              });
              return;
            }
          }
        } catch (e: any) {
          // Lock checks must never break trading on infra failure.
          console.warn('[trade] lock check failed (fail-open):', e?.message);
          portfolioCtx = {
            portfolioId: null,
            portfolioName: null,
            portfolioIds: [],
            locksUnchecked: true,
            locks: null,
          };
        }
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

      // Idempotency: retries with the same key + identical params replay the
      // stored result instead of opening a second position. API-key callers
      // MUST send Idempotency-Key; app sessions may omit it.
      const paramsHash = hashOrderParams({
        accountId: accountId!,
        symbolId,
        side: rawSide,
        orderType,
        volumeCents,
        limitPrice: body.limitPrice !== undefined ? Number(body.limitPrice) : null,
        stopPrice: body.stopPrice !== undefined ? Number(body.stopPrice) : null,
        stopLoss: body.stopLoss !== undefined ? Number(body.stopLoss) : null,
        takeProfit: body.takeProfit !== undefined ? Number(body.takeProfit) : null,
      });
      const idemKey = readIdempotencyKey();
      if (keyId) {
        if (!idemKey) {
          session.close();
          await auditLog(400);
          res.status(400).json({
            error: 'idempotency_key_required',
            message: 'Send a unique Idempotency-Key header (or idempotencyKey body field) with every open order so network retries cannot double-open positions. Reuse the same key only when retrying the identical order.',
          });
          return;
        }
        const prior = authenticatedUserId ? await lookupIdempotency(idemKey) : null;
        if (prior && String(prior.user_id) === String(authenticatedUserId)) {
          if (prior.params_hash === paramsHash && prior.status === 'completed') {
            session.close();
            await auditLog(200);
            res.status(200).json({ ...(prior.result as object), deduplicated: true });
            return;
          }
          session.close();
          await auditLog(409);
          res.status(409).json({
            error: 'idempotency_conflict',
            message: 'This Idempotency-Key was already used for a different order. Generate a fresh key for new orders.',
          });
          return;
        }
      }

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
      const openWarnings = portfolioCtx ? contextWarnings(portfolioCtx) : [];
      const responseBody = {
        ok: true,
        message: 'Order submitted',
        accountId,
        isDemo,
        ...(portfolioCtx ? { ...portfolioFields(portfolioCtx) } : {}),
        ...(openWarnings.length > 0 ? { warnings: openWarnings } : {}),
        result,
      };
      if (idemKey && authenticatedUserId) {
        await storeIdempotency({
          key: idemKey,
          user_id: authenticatedUserId,
          account_id: accountId!,
          params_hash: paramsHash,
          status: 'completed',
          result: responseBody,
        });
      }
      await auditLog(200);
      res.status(200).json(responseBody);
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
