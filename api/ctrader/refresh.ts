import type { VercelRequest, VercelResponse } from '@vercel/node';
import { persistRotatedCtraderToken } from '../_lib/jfxApiKey.js';

const CTRADER_TOKEN_URL = 'https://openapi.ctrader.com/apps/token';
const REFRESH_COOKIE = 'jfx_ctrader_refresh';

function getCredentials() {
  return {
    clientId: process.env.CTRADER_CLIENT_ID || process.env.VITE_CTRADER_CLIENT_ID || '',
    clientSecret: process.env.CTRADER_CLIENT_SECRET || process.env.VITE_CTRADER_CLIENT_SECRET || '',
  };
}

async function updateStoredRefreshToken(
  userId: string,
  newRefreshToken: string,
): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!supabaseUrl || !serviceKey || !userId || !newRefreshToken) return;

  try {
    // Upsert first so a missing row is created (PATCH-only silently drops rotation).
    await fetch(`${supabaseUrl}/rest/v1/user_ctrader_tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        user_id: userId,
        refresh_token: newRefreshToken,
        updated_at: new Date().toISOString(),
      }),
    }).catch(() => {});
    await fetch(`${supabaseUrl}/rest/v1/user_ctrader_tokens?user_id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        refresh_token: newRefreshToken,
        updated_at: new Date().toISOString(),
      }),
    });
  } catch (err) {
    console.error('[cTrader] Error updating stored refresh token:', err);
  }
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

  const authHeader = (req.headers['authorization'] || '') as string;
  const supabaseJwt = authHeader.replace(/^Bearer\s+/i, '').trim();

  try {
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
    const expiresIn = tokens.expiresIn || tokens.expires_in;
    if (!accessToken) {
      res.status(502).json({ error: 'cTrader refresh returned no access token' });
      return;
    }

    if (newRefreshToken) {
      res.setHeader('Set-Cookie', [
        `${REFRESH_COOKIE}=${encodeURIComponent(String(newRefreshToken))}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=31536000`,
      ]);

      if (supabaseJwt) {
        try {
          const [, payloadB64] = supabaseJwt.split('.');
          const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
          const userId = payload.sub as string | undefined;
          if (userId) {
            const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
            const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
            void updateStoredRefreshToken(userId, String(newRefreshToken));
            // Upsert as well (PATCH-only silently drops rotation when the row
            // is missing) and mirror service_config — same helper as trade.
            void persistRotatedCtraderToken({
              supabaseUrl,
              serviceKey,
              userId,
              newRefreshToken: String(newRefreshToken),
            });
          }
        } catch {}
      }
    }

    // Both casings so every client (and the dev mirror) reads the fields.
    res.json({
      access_token: accessToken,
      expires_in: expiresIn,
      refresh_token: newRefreshToken,
      accessToken,
      expiresIn,
      refreshToken: newRefreshToken,
    });
  } catch (err) {
    console.error('cTrader refresh error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Unexpected error during token refresh',
    });
  }
}
