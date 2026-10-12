/**
 * Shared JFX Personal API Key (jfx_pat_...) verifier for server routes.
 *
 * trade.ts grew its own inline copy of this logic; new agent-facing routes
 * (e.g. /api/ctrader/candles) must use this instead of duplicating it.
 * Closes two gaps in the old inline copy:
 *  - revocation was never checked (only expires_at)
 *  - the column select assumed dashboard DDL; unknown columns now fall back
 *    to the minimal select instead of failing closed
 */
import { createHash } from 'crypto';

export const JFX_PAT_PATTERN = /^jfx_pat_[a-z0-9]{8}_[A-Za-z0-9]{32}$/;

export type ApiScope = 'trades:read' | 'trades:write';

export interface ApiKeyIdentity {
  keyId: string;
  userId: string;
  scopes: string[];
}

export type ApiKeyVerifyResult =
  | { ok: true; identity: ApiKeyIdentity }
  | { ok: false; status: number; error: string; need?: string; have?: string[]; hint?: string };

/** sha256 hex of a raw PAT — matches how generate_api_key stores key_hash. */
export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Pull the raw credential from Authorization / X-API-Key / X-Access-Token. */
export function extractRawKey(
  headers: Record<string, string | string[] | undefined> | undefined,
): string {
  if (!headers) return '';
  const pick = (v: string | string[] | undefined): string =>
    Array.isArray(v) ? v[0] || '' : v || '';
  const raw =
    pick(headers['authorization'] as any) ||
    pick(headers['Authorization'] as any) ||
    pick(headers['x-api-key'] as any) ||
    pick(headers['x-access-token'] as any);
  return String(raw).replace(/^Bearer\s+/i, '').trim();
}

/** `trades:write` implies `trades:read`. */
export function checkScopes(have: string[] | undefined | null, required: ApiScope): boolean {
  const scopes = Array.isArray(have) ? have : [];
  if (scopes.includes(required)) return true;
  if (required === 'trades:read' && scopes.includes('trades:write')) return true;
  return false;
}

/**
 * Stable canonical form of an order's identity for idempotency hashing.
 * Key order is fixed so {a:1,b:2} and {b:2,a:1} hash identically.
 */
export function canonicalOrderParams(params: {
  accountId: number;
  symbolId: number;
  side: string;
  orderType: number;
  volumeCents: number;
  limitPrice?: number | null;
  stopPrice?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
}): string {
  const norm = (v: number | null | undefined): string =>
    v === undefined || v === null || !Number.isFinite(Number(v))
      ? ''
      : String(Number(v));
  return [
    `account:${Number(params.accountId)}`,
    `symbol:${Number(params.symbolId)}`,
    `side:${String(params.side).toLowerCase()}`,
    `type:${Number(params.orderType)}`,
    `vol:${Number(params.volumeCents)}`,
    `lp:${norm(params.limitPrice)}`,
    `sp:${norm(params.stopPrice)}`,
    `sl:${norm(params.stopLoss)}`,
    `tp:${norm(params.takeProfit)}`,
  ].join('|');
}

export function hashOrderParams(params: Parameters<typeof canonicalOrderParams>[0]): string {
  return createHash('sha256').update(canonicalOrderParams(params)).digest('hex');
}

export interface BrokerSymbol {
  symbolId: number | string;
  symbolName?: string;
  name?: string;
  digits?: number | string | null;
}

const cleanSymbol = (s: unknown): string =>
  String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export interface ResolvedSymbol {
  symbolId: number;
  symbolName: string;
  digits: number;
}

/**
 * Resolve a human symbol ("EURUSD", "eur/usd") to a broker symbolId.
 * Exact match wins — a loose `includes` fallback must never shadow an
 * exact listing (e.g. EURUSD must not resolve to EURUSDm when EURUSD exists).
 */
export function resolveSymbolId(symbols: BrokerSymbol[], raw: unknown): ResolvedSymbol | null {
  const clean = cleanSymbol(raw);
  if (!clean) return null;
  const norm = (s: BrokerSymbol): string =>
    cleanSymbol(s.symbolName || (s as any).name || '');
  const toResolved = (s: BrokerSymbol): ResolvedSymbol => ({
    symbolId: Number((s as any).symbolId),
    symbolName: String(s.symbolName || (s as any).name || raw),
    digits: Number.isFinite(Number((s as any).digits))
      ? Number((s as any).digits)
      : /JPY/.test(clean) ? 3 : 5,
  });
  const exact = (symbols || []).find((s) => norm(s) === clean && Number((s as any).symbolId) > 0);
  if (exact) return toResolved(exact);
  const fuzzy = (symbols || []).find(
    (s) => norm(s).includes(clean) && Number((s as any).symbolId) > 0,
  );
  return fuzzy ? toResolved(fuzzy) : null;
}

/** Up to `limit` broker symbol names containing the query — for 400 hints. */
export function suggestSymbols(symbols: BrokerSymbol[], raw: unknown, limit = 5): string[] {
  const clean = cleanSymbol(raw);
  if (!clean) return [];
  const out: string[] = [];
  for (const s of symbols || []) {
    const name = String(s.symbolName || (s as any).name || '');
    if (!name) continue;
    if (cleanSymbol(name).includes(clean) && !out.includes(name)) out.push(name);
    if (out.length >= limit) break;
  }
  return out;
}

function svcHeaders(serviceKey: string): Record<string, string> {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
}

/**
 * Verify a JFX PAT end-to-end: format → lookup → expiry → revocation →
 * scope → rate limit. Returns a failure descriptor the caller can send
 * directly (status + error + scope hints), or the identity on success.
 */
export async function verifyApiKey({
  supabaseUrl,
  serviceKey,
  rawKey,
  requiredScope,
  enforceRateLimit = true,
}: {
  supabaseUrl: string;
  serviceKey: string;
  rawKey: string;
  requiredScope: ApiScope;
  enforceRateLimit?: boolean;
}): Promise<ApiKeyVerifyResult> {
  if (!supabaseUrl || !serviceKey) {
    return { ok: false, status: 503, error: 'Database service not configured' };
  }
  if (!JFX_PAT_PATTERN.test(rawKey || '')) {
    return { ok: false, status: 401, error: 'invalid_api_key' };
  }

  let keyHash: string;
  try {
    keyHash = hashApiKey(rawKey);
  } catch (e: any) {
    return { ok: false, status: 500, error: 'hash_failed' };
  }

  // Prefer the full select (incl. revocation columns); fall back to the
  // minimal select when the dashboard DDL predates status/revoked_at.
  let apiKey: any = null;
  try {
    let qr = await fetch(
      `${supabaseUrl}/rest/v1/api_keys?key_hash=eq.${keyHash}&select=id,user_id,scopes,expires_at,status,revoked_at`,
      { headers: svcHeaders(serviceKey) },
    );
    if (!qr.ok) {
      qr = await fetch(
        `${supabaseUrl}/rest/v1/api_keys?key_hash=eq.${keyHash}&select=id,user_id,scopes,expires_at`,
        { headers: svcHeaders(serviceKey) },
      );
    }
    const rows = await qr.json().catch(() => []);
    apiKey = Array.isArray(rows) ? rows[0] : null;
  } catch {
    apiKey = null;
  }

  if (!apiKey) {
    return { ok: false, status: 401, error: 'invalid_api_key' };
  }
  if (apiKey.expires_at && new Date(apiKey.expires_at).getTime() <= Date.now()) {
    return { ok: false, status: 401, error: 'expired_api_key' };
  }
  if (
    (apiKey.status !== undefined && apiKey.status !== null && apiKey.status !== 'active') ||
    apiKey.revoked_at
  ) {
    return { ok: false, status: 401, error: 'revoked_api_key' };
  }

  const scopes: string[] = Array.isArray(apiKey.scopes) ? apiKey.scopes : [];
  if (!checkScopes(scopes, requiredScope)) {
    return {
      ok: false,
      status: 403,
      error: 'insufficient_scope',
      need: requiredScope,
      have: scopes,
      hint:
        requiredScope === 'trades:write'
          ? 'Recreate the key in Settings → Developer Tools with trades:write enabled'
          : 'Requires trades:read (or trades:write)',
    };
  }

  const identity: ApiKeyIdentity = {
    keyId: String(apiKey.id),
    userId: String(apiKey.user_id),
    scopes,
  };

  // 429 only when the limiter explicitly denies; transport/RPC errors are
  // 503 so a missing migration is never misreported as "rate limited".
  if (enforceRateLimit) {
    try {
      const rl = await fetch(`${supabaseUrl}/rest/v1/rpc/consume_api_key_rate_limit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...svcHeaders(serviceKey) },
        body: JSON.stringify({ p_user_id: identity.userId, p_key_id: identity.keyId }),
      });
      if (!rl.ok) {
        return {
          ok: false,
          status: 503,
          error: 'rate_limiter_unavailable',
        };
      }
      const allowed = await rl.json().catch(() => true);
      if (allowed === false) {
        return { ok: false, status: 429, error: 'rate_limited' };
      }
    } catch {
      return { ok: false, status: 503, error: 'rate_limiter_unavailable' };
    }
  }

  // Touch last_used_at — fire-and-forget, never blocks the request.
  void fetch(`${supabaseUrl}/rest/v1/api_keys?id=eq.${identity.keyId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...svcHeaders(serviceKey) },
    body: JSON.stringify({ last_used_at: new Date().toISOString() }),
  }).catch(() => {});

  return { ok: true, identity };
}

/** Fire-and-forget per-key audit row. No-op without a key identity. */
export function auditApiKeyCall({
  supabaseUrl,
  serviceKey,
  keyId,
  userId,
  method,
  path,
  status,
  durationMs,
  userAgent,
}: {
  supabaseUrl: string;
  serviceKey: string;
  keyId: string | null;
  userId: string | null;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  userAgent: string;
}): void {
  if (!keyId || !userId || !supabaseUrl || !serviceKey) return;
  void fetch(`${supabaseUrl}/rest/v1/api_key_audit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...svcHeaders(serviceKey) },
    body: JSON.stringify({
      key_id: keyId,
      user_id: userId,
      method,
      path,
      status,
      duration_ms: durationMs,
      user_agent: userAgent || 'AI Agent',
    }),
  }).catch(() => {});
}
