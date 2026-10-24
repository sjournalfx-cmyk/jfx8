// Pure UI helpers for the Personal API Keys panel. Kept out of the React
// component so lifecycle/error wording can be unit-tested.

export type ApiKeyState = 'active' | 'expiring' | 'expired' | 'revoked';

export interface ApiKeyLike {
  status?: string | null;
  expires_at?: string | null;
  revoked_at?: string | null;
}

export interface ApiKeyStatus {
  state: ApiKeyState;
  label: string;
  tone: 'success' | 'warning' | 'danger';
  daysLeft?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRING_WINDOW_DAYS = 7;

export function getApiKeyStatus(key: ApiKeyLike, now: number = Date.now()): ApiKeyStatus {
  if (key.status === 'revoked' || key.revoked_at) {
    return { state: 'revoked', label: 'Revoked', tone: 'danger' };
  }
  if (!key.expires_at) {
    return { state: 'active', label: 'Active', tone: 'success' };
  }
  const expiresMs = Date.parse(key.expires_at);
  if (!Number.isFinite(expiresMs)) {
    return { state: 'active', label: 'Active', tone: 'success' };
  }
  const msLeft = expiresMs - now;
  if (msLeft <= 0) {
    return { state: 'expired', label: 'Expired', tone: 'danger' };
  }
  const daysLeft = Math.ceil(msLeft / DAY_MS);
  if (daysLeft <= EXPIRING_WINDOW_DAYS) {
    return { state: 'expiring', label: `Expires in ${daysLeft}d`, tone: 'warning', daysLeft };
  }
  return { state: 'active', label: 'Active', tone: 'success', daysLeft };
}

const ERROR_HINTS: Record<string, string> = {
  missing_api_key: 'No API key was sent. Add X-API-Key or Authorization: Bearer.',
  malformed_token: 'The key is truncated or malformed. Copy the full jfx_pat_ value.',
  invalid_token: 'The key was not recognised. Recreate it and copy the full value.',
  expired_token: 'The key expired. Create a new key with a later expiry.',
  revoked_api_key: 'The key was revoked. Create a new key.',
  insufficient_scope: 'The key lacks the required scope. Recreate it with that permission.',
  rate_limited: 'Rate limited. Wait for Retry-After, then retry.',
  rate_limiter_unavailable: 'The rate limiter is temporarily down. Retry shortly; do not recreate the key.',
  locked_by_rule: 'A portfolio trading lock blocked the order. Do not retry; review the rule context.',
  idempotency_key_required: 'Open orders need a fresh Idempotency-Key UUID.',
  idempotency_conflict: 'That Idempotency-Key was already used with different parameters. Use a fresh UUID.',
  ctrader_not_connected: 'The key is valid, but cTrader is not connected. Connect it once on Connect & Import.',
  ctrader_refresh_in_progress: 'cTrader is refreshing this account. Retry in a moment.',
  ctrader_auth_failed: 'The stored cTrader grant expired or was revoked. Reconnect cTrader, then retry.',
  unknown_account: 'That ctidTraderAccountId is unknown. Call get_accounts and retry with a valid id.',
  auth_failed: 'Authentication failed. Verify the key and the cTrader connection.',
  server_not_configured: 'The API is not configured on the server. Contact the operator.',
  service_unavailable: 'The API is temporarily unavailable. Retry shortly.',
  internal_error: 'The server hit an internal error. Retry shortly; if it persists, report it.',
  not_found: 'That endpoint or resource was not found. Check the URL and parameters.',
};

export function describeApiError(code: string | null | undefined, status?: number): string {
  const normalized = String(code || '').trim().toLowerCase();
  if (normalized && ERROR_HINTS[normalized]) return ERROR_HINTS[normalized];
  if (status === 401) return ERROR_HINTS.invalid_token;
  if (status === 403) return ERROR_HINTS.insufficient_scope;
  if (status === 404) return ERROR_HINTS.not_found;
  if (status === 429) return ERROR_HINTS.rate_limited;
  if (status && status >= 500) return ERROR_HINTS.service_unavailable;
  return normalized ? `Request failed (${normalized}).` : 'Request failed. See the response for details.';
}

export function formatRelativeTime(value: string | null | undefined, now: number = Date.now()): string {
  if (!value) return 'Never';
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return 'Unknown';
  const diff = now - ms;
  if (diff < 45_000) return 'Just now';
  if (diff < 0) {
    const mins = Math.ceil(-diff / 60_000);
    return mins < 60 ? `in ${mins}m` : `in ${Math.ceil(mins / 60)}h`;
  }
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}
