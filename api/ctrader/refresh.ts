import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCorsHeaders } from '../_lib/cors';

const CTRADER_TOKEN_URL = 'https://openapi.ctrader.com/apps/token';
const REFRESH_COOKIE = 'jfx_ctrader_refresh';

// Server-only credentials. The client secret must never be shipped to the browser.
const CLIENT_ID = process.env.CTRADER_CLIENT_ID || '';
const CLIENT_SECRET = process.env.CTRADER_CLIENT_SECRET || '';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCorsHeaders(res, req.headers);
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

  if (!CLIENT_ID || !CLIENT_SECRET) {
    res.status(500).json({ error: 'cTrader OAuth credentials not configured on the server' });
    return;
  }

  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });

    const tokenRes = await fetch(CTRADER_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('cTrader refresh failed:', tokenRes.status, errText);
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
