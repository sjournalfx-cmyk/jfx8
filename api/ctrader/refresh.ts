import type { VercelRequest, VercelResponse } from '@vercel/node';

const CTRADER_TOKEN_URL = 'https://openapi.ctrader.com/apps/token';
const REFRESH_COOKIE = 'jfx_ctrader_refresh';

function getCredentials() {
  return {
    clientId: process.env.CTRADER_CLIENT_ID || process.env.VITE_CTRADER_CLIENT_ID || '',
    clientSecret: process.env.CTRADER_CLIENT_SECRET || process.env.VITE_CTRADER_CLIENT_SECRET || '',
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Same-origin endpoint; do not depend on the shared CORS helper at function
  // startup because a failed import makes the whole Vercel Function return 500.
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // The refresh token is only ever read from the httpOnly cookie set during the
  // exchange — never from the request body, which a script attacker could supply.
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
      // Log the status code only — upstream response bodies can contain
      // sensitive fragments and must not end up in server logs.
      console.error('cTrader refresh failed:', tokenRes.status);
      res.status(502).json({
        error: 'Token refresh failed',
        status: tokenRes.status,
      });
      return;
    }

    const tokens = await tokenRes.json();

    // Rotate the refresh cookie if cTrader issued a new one.
    if (tokens.refresh_token) {
      res.setHeader('Set-Cookie', [
        `${REFRESH_COOKIE}=${encodeURIComponent(String(tokens.refresh_token))}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=31536000`,
      ]);
    }

    res.json({
      access_token: tokens.access_token,
      expires_in: tokens.expires_in,
    });
  } catch (err) {
    console.error('cTrader refresh error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Unexpected error during token refresh',
    });
  }
}
