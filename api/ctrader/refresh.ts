import type { VercelRequest, VercelResponse } from '@vercel/node';

const CTRADER_TOKEN_URL = 'https://openapi.ctrader.com/apps/token';

const CLIENT_ID = process.env.VITE_CTRADER_CLIENT_ID || process.env.CTRADER_CLIENT_ID || '';
const CLIENT_SECRET = process.env.CTRADER_CLIENT_SECRET || '';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
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

  const { refresh_token } = req.body || {};

  if (!refresh_token) {
    res.status(400).json({ error: 'Missing refresh_token' });
    return;
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    res.status(500).json({ error: 'cTrader OAuth credentials not configured' });
    return;
  }

  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: String(refresh_token),
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
        details: errText,
      });
      return;
    }

    const tokens = await tokenRes.json();
    res.json({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || refresh_token,
      expires_in: tokens.expires_in,
      scope: tokens.scope,
    });
  } catch (err) {
    console.error('cTrader refresh error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Unexpected error during token refresh',
    });
  }
}
