/**
 * cTrader OAuth return bookkeeping.
 *
 * The server callback only forwards `code`, so a cancel/deny lands back on the
 * app root with no query parameters at all. Remember that an authorization was
 * in flight before redirecting; if we come back without a code the attempt was
 * cancelled or denied, and the UI can say so instead of silently showing the
 * dashboard.
 */
export const CTRADER_OAUTH_PENDING_KEY = 'jfx_ctrader_oauth_pending';
export const CTRADER_OAUTH_PENDING_MAX_AGE_MS = 15 * 60 * 1000;

export function markCtraderOauthPending(now: number = Date.now()): void {
  try {
    sessionStorage.setItem(CTRADER_OAUTH_PENDING_KEY, String(now));
  } catch {
    /* storage blocked */
  }
}

export function clearCtraderOauthPending(): void {
  try {
    sessionStorage.removeItem(CTRADER_OAUTH_PENDING_KEY);
  } catch {
    /* storage blocked */
  }
}

/**
 * Returns true when an OAuth attempt was started recently and we came back
 * without an authorization code. Always consumes the marker.
 */
export function consumeCtraderOauthCancellation(
  now: number = Date.now(),
  maxAgeMs: number = CTRADER_OAUTH_PENDING_MAX_AGE_MS,
): boolean {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(CTRADER_OAUTH_PENDING_KEY);
    sessionStorage.removeItem(CTRADER_OAUTH_PENDING_KEY);
  } catch {
    return false;
  }
  if (!raw) return false;
  const startedAt = Number(raw);
  if (!Number.isFinite(startedAt) || startedAt <= 0) return false;
  const age = now - startedAt;
  return age >= 0 && age <= maxAgeMs;
}
