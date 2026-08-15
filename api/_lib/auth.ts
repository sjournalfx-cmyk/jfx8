import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

export type AuthResult = {
  ok: boolean;
  status: number;
  error?: string;
  /** Supabase user id, present when `ok` is true. Used for per-user rate limiting. */
  userId?: string;
};

function getAuthHeader(headers: Record<string, string | string[] | undefined> | undefined): string {
  if (!headers) return '';
  const value = headers['authorization'] || headers['Authorization'];
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

/**
 * Verifies the caller's Supabase user session. Any endpoint that proxies a paid
 * AI/transcription provider must call this first so the quota cannot be burned
 * by unauthenticated attackers (including other websites via CORS).
 */
export async function requireUser(
  headers: Record<string, string | string[] | undefined> | undefined,
): Promise<AuthResult> {
  const token = getAuthHeader(headers).replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return { ok: false, status: 401, error: 'Missing Authorization header' };
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false, status: 500, error: 'Supabase is not configured on the server' };
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      return { ok: false, status: 401, error: 'Invalid or expired session' };
    }
    return { ok: true, status: 200, userId: data.user.id };
  } catch {
    return { ok: false, status: 401, error: 'Invalid session' };
  }
}

/** True when the caller presents a valid session (used for OPTIONS/health checks). */
export function hasAuthHeader(headers: Record<string, string | string[] | undefined> | undefined): boolean {
  return Boolean(getAuthHeader(headers));
}
