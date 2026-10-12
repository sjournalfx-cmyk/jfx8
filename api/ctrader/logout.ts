import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCorsHeaders } from '../_lib/cors.js';
import { requireUser } from '../_lib/auth.js';

const REFRESH_COOKIE = 'jfx_ctrader_refresh';

/**
 * POST /api/ctrader/logout
 *
 * Fully signs the user out of cTrader on this deployment:
 * - expires the httpOnly refresh cookie
 * - deletes the server-stored refresh token row for the authenticated
 *   Supabase user (verified via requireUser, never an unverified sub decode)
 *
 * After this, POST /api/ctrader/refresh must 401 and the client must
 * stay on the "Connect" screen until the user explicitly re-grants.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  applyCorsHeaders(res, req.headers);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Expire the httpOnly refresh cookie (best-effort — always sent).
  res.setHeader(
    'Set-Cookie',
    `${REFRESH_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`,
  );

  // Delete the server-stored refresh token for this user (native-app path
  // where cookies are unavailable). The user id comes from a VERIFIED session
  // (never an unverified JWT sub decode). Best-effort: never fail the logout
  // when credentials are missing, the cookie expiry above still applies.
  try {
    const auth = await requireUser(req.headers);
    const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
    const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    const userId = auth.ok ? auth.userId : undefined;
    if (userId && supabaseUrl && serviceKey) {
      await fetch(
        `${supabaseUrl}/rest/v1/user_ctrader_tokens?user_id=eq.${encodeURIComponent(userId)}`,
        {
          method: 'DELETE',
          headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        },
      );
    }
  } catch (err) {
    console.error('[cTrader] logout DB cleanup failed:', err);
  }

  res.status(200).json({ ok: true });
}
