import { createClient } from '@supabase/supabase-js';

export type RateLimitResult = {
  allowed: boolean;
  retryAfterMs?: number;
  unavailable?: boolean;
  degraded?: boolean;
};

// Degraded-mode guard: when the shared (Supabase RPC) limiter is unreachable,
// fail OPEN with a per-instance sliding window instead of 503-ing every user.
// One instance can at most let `limit` requests per window through, so the
// paid quota stays roughly protected while the feature survives a Supabase
// blip — even with many users hitting different instances concurrently.
const localHits = new Map<string, number[]>();
const LOCAL_MAP_MAX_KEYS = 2000;

function localAllow(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const recent = (localHits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    localHits.set(key, recent);
    return { allowed: false, retryAfterMs: Math.max(0, recent[0] + windowMs - now), degraded: true };
  }
  recent.push(now);
  localHits.set(key, recent);
  if (localHits.size > LOCAL_MAP_MAX_KEYS) {
    const oldest = localHits.keys().next().value;
    if (oldest !== undefined) localHits.delete(oldest);
  }
  return { allowed: true, degraded: true };
}

export async function rateLimit(
  key: string,
  limit: number,
  windowMs = 60_000,
): Promise<RateLimitResult> {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!supabaseUrl || !serviceKey || !Number.isFinite(limit) || limit < 1 || windowMs < 1) {
    if (Number.isFinite(limit) && limit >= 1 && windowMs >= 1) {
      return localAllow(key, Math.floor(limit), windowMs);
    }
    return { allowed: false, unavailable: true };
  }

  try {
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.rpc('consume_proxy_rate_limit', {
      p_key: key,
      p_limit: Math.floor(limit),
      p_window_seconds: Math.max(1, Math.ceil(windowMs / 1000)),
    });
    if (error || !Array.isArray(data) || data.length !== 1) {
      console.error('Global rate limiter failed, using degraded local guard:', error?.message || 'empty result');
      return localAllow(key, Math.floor(limit), windowMs);
    }

    const result = data[0] as { allowed?: boolean; retry_after_seconds?: number };
    return {
      allowed: result.allowed === true,
      retryAfterMs: Math.max(0, Number(result.retry_after_seconds || 0) * 1000),
    };
  } catch (error) {
    console.error('Global rate limiter failed, using degraded local guard:', error);
    return localAllow(key, Math.floor(limit), windowMs);
  }
}
