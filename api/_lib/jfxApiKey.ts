/**
 * Shared JFX personal API-key helpers.
 *
 * Single source of truth for:
 * - token format (jfx_pat_<8>_<32>)
 * - header extraction (X-API-Key, Authorization: Bearer, X-Access-Token)
 * - isDemo parsing (boolean|string|number safe — "false" !== true)
 * - trade scope checks (trades:write implies trades:read)
 * - cTrader volume conversion + account picking (demo/live aware)
 * - rotated refresh-token persistence (upsert, never PATCH-only)
 *
 * Import from Vercel functions as `from './_lib/jfxApiKey.js'`
 * (and `../_lib/jfxApiKey.js` one level deeper). Keep this file free of
 * Node-only imports so Vitest + Edge runtimes can both load the pure
 * helpers; Supabase persistence helpers take fetch as an implicit global.
 */

export const JFX_TOKEN_PATTERN = /^jfx_pat_[a-z0-9]{8}_[A-Za-z0-9]{32}$/;

export const CTRADER_VOLUME_CENTS_PER_LOT = 10_000_000;
export const CTRADER_VOLUME_CENTS_PER_UNIT = 100;

type HeaderMap = Record<string, string | string[] | undefined>;

function firstHeader(headers: HeaderMap, names: string[]): string {
  // Node lowercases incoming headers, but harnesses/tests may use any case.
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers || {})) {
    const val = Array.isArray(v) ? (v[0] || '') : (v || '');
    lower[k.toLowerCase()] = String(val);
    // keep original too for direct lookup
    (lower as Record<string, string>)[k] = String(val);
  }
  for (const n of names) {
    const hit = lower[n.toLowerCase()] ?? lower[n] ?? '';
    if (hit) return hit;
  }
  return '';
}

/** Strip common scheme prefixes agents like to add ("Bearer ", "Token ", "ApiKey "). */
export function stripAuthScheme(value: string): string {
  return String(value || '')
    .trim()
    .replace(/^(Bearer|Token|ApiKey|APIKey)\s+/i, '')
    .trim();
}

/**
 * Extract a raw JFX personal API key (or raw cTrader access token fallback)
 * from request headers. Accepts:
 * - X-API-Key: <key>
 * - Authorization: Bearer <key> (or bare key)
 * - X-Access-Token: <key>
 */
export function extractRawApiKey(headers: HeaderMap): string {
  const combined =
    firstHeader(headers, ['x-api-key']) ||
    firstHeader(headers, ['authorization']) ||
    firstHeader(headers, ['x-access-token']);
  return stripAuthScheme(combined);
}

export function isJfxApiKey(value: string): boolean {
  return JFX_TOKEN_PATTERN.test(String(value || '').trim());
}

/**
 * Parse isDemo safely. The classic bug is Boolean("false") === true.
 * Accepts boolean | number | string ("true"/"false"/"1"/"0"/"demo"/"live"/"yes"/"no").
 */
export function parseIsDemo(value: unknown, defaultValue = true): boolean {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const s = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'demo', 'paper'].includes(s)) return true;
  if (['false', '0', 'no', 'n', 'live', 'real'].includes(s)) return false;
  return defaultValue;
}

export function hasTradeScope(scopes: string[] | undefined | null, required: 'trades:read' | 'trades:write'): boolean {
  const list = Array.isArray(scopes) ? scopes : [];
  if (list.includes(required)) return true;
  // trades:write implies trades:read everywhere (journal + cTrader).
  if (required === 'trades:read' && list.includes('trades:write')) return true;
  return false;
}

export function toVolumeCents(volumeLots: number): number {
  const v = Number(volumeLots);
  if (!Number.isFinite(v) || v <= 0) throw new Error('Invalid volume');
  if (v >= 500) return Math.round(v * CTRADER_VOLUME_CENTS_PER_UNIT);
  return Math.round(v * CTRADER_VOLUME_CENTS_PER_LOT);
}

export type CtraderAccountRef = {
  ctidTraderAccountId: number | string;
  isLive?: boolean;
  [k: string]: unknown;
};

/**
 * Pick the cTrader account to trade on:
 * - explicit requestedId wins when it exists (and is returned so callers can
 *   detect demo/live mismatches and self-heal),
 * - otherwise prefer accounts matching isDemo, falling back to first.
 */
export function chooseCtraderAccount(
  accounts: CtraderAccountRef[],
  isDemo: boolean,
  requestedId?: number | null,
): { accountId: number; matched: CtraderAccountRef | null; mismatch: boolean } {
  const list = Array.isArray(accounts) ? accounts : [];
  if (requestedId && Number.isFinite(Number(requestedId)) && Number(requestedId) > 0) {
    const target = list.find((a) => Number(a.ctidTraderAccountId) === Number(requestedId)) || null;
    const mismatch = Boolean(target && typeof target.isLive === 'boolean' && (isDemo ? target.isLive : !target.isLive));
    return { accountId: Number(requestedId), matched: target, mismatch };
  }
  if (list.length === 0) return { accountId: 0, matched: null, mismatch: false };
  const filtered = list.filter((a) => (isDemo ? a.isLive === false : a.isLive === true));
  const chosen = (filtered.length ? filtered[0] : list[0]) as CtraderAccountRef;
  return { accountId: Number(chosen.ctidTraderAccountId), matched: chosen, mismatch: false };
}

/** Find a same-host alternative when the requested account lives on the other host. */
export function findAltAccountForHost(
  accounts: CtraderAccountRef[],
  isDemo: boolean,
  excludeId?: number | null,
): CtraderAccountRef | null {
  const list = Array.isArray(accounts) ? accounts : [];
  return (
    list.find(
      (a) =>
        (isDemo ? a.isLive === false : a.isLive === true) &&
        (!excludeId || Number(a.ctidTraderAccountId) !== Number(excludeId)),
    ) || null
  );
}

/** cTrader mint errors that are worth retrying once with the global service token. */
export function isFallbackWorthyCtraderError(message: string): boolean {
  const m = String(message || '').toLowerCase();
  return (
    m.includes('access denied') ||
    m.includes('access_denied') ||
    m.includes('invalid_grant') ||
    m.includes('invalid grant') ||
    m.includes('invalid_token') ||
    m.includes('expired') ||
    m.includes('revoked') ||
    m.includes('ch_access_denied')
  );
}

/** Consistent error envelope shared by /api/ctrader/trade and jfx-api. */
export function apiKeyError(
  error: string,
  message?: string,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return { error, ...(message ? { message } : {}), ...(extra || {}) };
}

/**
 * Persist a rotated cTrader refresh token. cTrader rotates the refresh token
 * on every mint, so a PATCH-only write silently drops the new token when the
 * row does not exist yet (0 rows affected). Always upsert first, then PATCH
 * for older PostgREST configs. A failed primary persistence write must be
 * reported: accepting it would invalidate the previous single-use token.
 */
export async function persistRotatedCtraderToken(args: {
  supabaseUrl: string;
  serviceKey: string;
  userId: string;
  newRefreshToken: string;
  previousToken?: string;
  newAccessToken?: string;
  accessTokenExpiresAt?: string;
}): Promise<void> {
  const {
    supabaseUrl, serviceKey, userId, newRefreshToken, previousToken,
    newAccessToken, accessTokenExpiresAt,
  } = args;
  if (!supabaseUrl || !serviceKey || !userId || !newRefreshToken) {
    throw new Error('Cannot persist cTrader token: database configuration or token is missing.');
  }
  const base = supabaseUrl.replace(/\/$/, '');
  const headers = {
    'Content-Type': 'application/json',
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  };
  const tokenRecord = {
    user_id: userId,
    refresh_token: newRefreshToken,
    ...(newAccessToken ? { access_token: newAccessToken } : {}),
    ...(accessTokenExpiresAt ? { access_token_expires_at: accessTokenExpiresAt } : {}),
    updated_at: new Date().toISOString(),
  };
  const body = JSON.stringify(tokenRecord);
  // 1. Upsert (creates the row when missing — the PATCH-only bug fix).
  let upsertStatus = 0;
  let upsertDetail = '';
  let upsertFailed = false;
  try {
    const upsertResponse = await fetch(`${base}/rest/v1/user_ctrader_tokens`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
      body,
    });
    upsertStatus = upsertResponse.status;
    if (!upsertResponse.ok) {
      upsertFailed = true;
      try { upsertDetail = (await upsertResponse.text()).slice(0, 300); } catch { /* ignore */ }
    }
  } catch (err) {
    upsertFailed = true;
    upsertDetail = err instanceof Error ? err.message.slice(0, 300) : 'network error';
  }
  if (upsertFailed) {
    // 2. PATCH as well for existing rows on strict configs.
    try {
      const patchResponse = await fetch(`${base}/rest/v1/user_ctrader_tokens?user_id=eq.${userId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          refresh_token: newRefreshToken,
          ...(newAccessToken ? { access_token: newAccessToken } : {}),
          ...(accessTokenExpiresAt ? { access_token_expires_at: accessTokenExpiresAt } : {}),
          updated_at: new Date().toISOString(),
        }),
      });
      if (!patchResponse.ok) {
        let patchDetail = '';
        try { patchDetail = (await patchResponse.text()).slice(0, 300); } catch { /* ignore */ }
        throw new Error(
          `Failed to persist rotated cTrader token (upsert HTTP ${upsertStatus}${upsertDetail ? `: ${upsertDetail}` : ''}; patch HTTP ${patchResponse.status}${patchDetail ? `: ${patchDetail}` : ''}).`,
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Failed to persist rotated cTrader token')) throw err;
      throw new Error(
        `Failed to persist rotated cTrader token (upsert HTTP ${upsertStatus}${upsertDetail ? `: ${upsertDetail}` : ''}; patch transport error: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown'}).`,
      );
    }
  }

  // Mirror the per-user legacy key while existing deployments migrate. This
  // mirror is intentionally non-authoritative; no global credential is read.
  void fetch(`${base}/rest/v1/service_config`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ key: `ctrader_refresh_${userId}`, value: newRefreshToken }),
    }).catch(() => {});
}
