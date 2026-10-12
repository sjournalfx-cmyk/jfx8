/**
 * Shared cTrader broker-session helpers (extracted verbatim from
 * api/ctrader/trade.ts so new agent routes reuse one copy):
 * WS session open, refresh-token mint, and the cached/lease-guarded
 * per-user access-token loader.
 */
import WebSocket from 'ws';
import { setCtraderRefreshLease } from './ctraderTokenLock.js';
import { persistRotatedCtraderToken } from './ctraderTokens.js';

const CTRADER_TOKEN_URL = 'https://openapi.ctrader.com/apps/token';

export interface WsSession {
  send: (payloadType: number, payload: Record<string, any>) => Promise<any>;
  close: () => void;
}

/** Parse isDemo safely — Boolean("false") === true, so handle strings explicitly. */
export function parseIsDemo(value: unknown, defaultValue = true): boolean {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const s = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'demo', 'paper'].includes(s)) return true;
  if (['false', '0', 'no', 'n', 'live', 'real'].includes(s)) return false;
  return defaultValue;
}

export function openCtraderSession(
  host: string,
  clientId: string,
  clientSecret: string,
  ctidTraderAccountId: number,
  accessToken: string,
  timeoutMs: number = 25000,
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
          if (msg.payloadType === 2142) {
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
        await send(2100, { clientId, clientSecret });
        if (ctidTraderAccountId && ctidTraderAccountId > 0) {
          await send(2102, { ctidTraderAccountId, accessToken });
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
 * Mint a fresh cTrader access token from a refresh token. Returns the
 * rotated token pair — callers must persist the replacement refresh token
 * via persistRotatedCtraderToken (upsert, throwing on failure) because
 * cTrader refresh tokens are single-use.
 */
export async function mintAccessToken(
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

/**
 * Resolve a user's cTrader access token server-side: reuse the cached
 * access token while valid, otherwise mint under a short DB lease so
 * concurrent requests serialize instead of burning single-use grants.
 */
export async function loadUserCtraderAccessToken({
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
  const readDefaults = (stored: StoredToken | null) => ({
    defaultAccountId: stored?.default_account_id ? Number(stored.default_account_id) : null,
    defaultIsDemo: stored?.is_demo !== undefined ? parseIsDemo(stored.is_demo, true) : true,
  });
  const cacheIsValid = (stored: StoredToken | null) => {
    const expiresAt = stored?.access_token_expires_at ? Date.parse(stored.access_token_expires_at) : Number.NaN;
    return Boolean(stored?.access_token && Number.isFinite(expiresAt) && expiresAt > Date.now() + 60_000);
  };

  let stored = await loadStoredToken();
  if (cacheIsValid(stored)) {
    return { accessToken: String(stored!.access_token), ...readDefaults(stored) };
  }

  const leaseAcquired = await setCtraderRefreshLease(supabaseUrl, serviceKey, userId, true);
  if (!leaseAcquired) throw new Error('ctrader_refresh_in_progress');

  try {
    // Read after acquiring the lease so a caller that waited behind another
    // rotation uses the replacement token rather than the stale one.
    stored = await loadStoredToken();
    if (cacheIsValid(stored)) {
      return { accessToken: String(stored!.access_token), ...readDefaults(stored) };
    }

    let refreshToken = stored?.refresh_token ? String(stored.refresh_token) : '';
    const { defaultAccountId, defaultIsDemo } = readDefaults(stored);

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
      newAccessToken: minted.accessToken,
      accessTokenExpiresAt: new Date(Date.now() + minted.expiresInSeconds * 1000).toISOString(),
    });

    return { accessToken: minted.accessToken, defaultAccountId, defaultIsDemo };
  } finally {
    await setCtraderRefreshLease(supabaseUrl, serviceKey, userId, false).catch(() => undefined);
  }
}
