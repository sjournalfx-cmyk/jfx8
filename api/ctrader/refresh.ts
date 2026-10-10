import type { VercelRequest, VercelResponse } from '@vercel/node';
import { persistRotatedCtraderToken } from '../_lib/jfxApiKey.js';
import { requireUser } from '../_lib/auth.js';
import { setCtraderRefreshLease } from '../_lib/ctraderTokenLock.js';

const CTRADER_TOKEN_URL = 'https://openapi.ctrader.com/apps/token';
const REFRESH_COOKIE = 'jfx_ctrader_refresh';

function getCredentials() {
  // Client ID is a public OAuth identifier: accept the VITE_ copy as a
  // fallback so deployments that only set VITE_CTRADER_CLIENT_ID still work.
  // The secret stays server-only (never read from a VITE_ var here).
  return {
    clientId: process.env.CTRADER_CLIENT_ID || process.env.VITE_CTRADER_CLIENT_ID || '',
    clientSecret: process.env.CTRADER_CLIENT_SECRET || '',
  };
}


export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const auth = await requireUser(req.headers);
  if (!auth.ok || !auth.userId) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  const refreshToken = (req.cookies?.[REFRESH_COOKIE] || '') as string;
  if (!refreshToken) {
    res.status(401).json({ error: 'Missing cTrader session' });
    return;
  }

  const { clientId, clientSecret } = getCredentials();
  if (!clientId || !clientSecret) {
    res.status(503).json({ error: 'cTrader OAuth credentials are not configured for this deployment' });
    return;
  }

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl || !serviceKey) {
    res.status(503).json({ error: 'Database service is required to refresh cTrader securely' });
    return;
  }

  let leaseAcquired = false;
  try {
    leaseAcquired = await setCtraderRefreshLease(supabaseUrl, serviceKey, auth.userId, true);
    if (!leaseAcquired) {
      res.setHeader('Retry-After', '1');
      res.status(503).json({ error: 'ctrader_refresh_in_progress' });
      return;
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });

    const tokenRes = await fetch(CTRADER_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!tokenRes.ok) {
      console.error('cTrader refresh failed:', tokenRes.status);
      res.status(502).json({
        error: 'Token refresh failed',
        status: tokenRes.status,
      });
      return;
    }

    const tokens = await tokenRes.json();

    // cTrader answers HTTP 200 with an errorCode body on grant failures —
    // surface it instead of returning empty tokens (which also silently
    // burned the single-use refresh token with nothing persisted).
    if (tokens.errorCode || tokens.error) {
      console.error('cTrader refresh errorCode:', tokens.errorCode, tokens.description);
      res.status(502).json({
        error: tokens.description || tokens.error_description || tokens.errorCode || tokens.error || 'Token refresh failed',
        errorCode: tokens.errorCode,
      });
      return;
    }

    // cTrader uses camelCase (accessToken/refreshToken/expiresIn). Accept
    // snake_case too — the old code read only snake_case, so every web
    // session restore minted (burning the single-use grant) and then
    // persisted nothing, locking out both the web app and API-key trading.
    const accessToken = tokens.accessToken || tokens.access_token;
    const newRefreshToken = tokens.refreshToken || tokens.refresh_token;
    if (!accessToken) {
      res.status(502).json({ error: 'cTrader refresh returned no access token' });
      return;
    }

    if (!newRefreshToken) {
      res.status(502).json({ error: 'cTrader refresh returned no replacement refresh token' });
      return;
    }

    try {
      await persistRotatedCtraderToken({
        supabaseUrl,
        serviceKey,
        userId: auth.userId,
        newRefreshToken: String(newRefreshToken),
        previousToken: refreshToken,
        newAccessToken: String(accessToken),
        accessTokenExpiresAt: new Date(Date.now() + (Number.isFinite(Number(tokens.expiresIn || tokens.expires_in)) ? Math.max(60, Number(tokens.expiresIn || tokens.expires_in)) : 300) * 1000).toISOString(),
      });
    } catch (error) {
      console.error('[cTrader] Refresh: failed to persist token', error);
      res.status(503).json({ error: 'Could not securely rotate the cTrader connection. Please reconnect.' });
      return;
    }

    res.setHeader('Set-Cookie', [
      `${REFRESH_COOKIE}=${encodeURIComponent(String(newRefreshToken))}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=31536000`,
    ]);

    res.json({ ok: true });
  } catch (err) {
    console.error('cTrader refresh error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Unexpected error during token refresh',
    });
  } finally {
    if (leaseAcquired) {
      await setCtraderRefreshLease(supabaseUrl, serviceKey, auth.userId, false).catch(() => undefined);
    }
  }
}
