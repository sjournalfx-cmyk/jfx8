import type { VercelRequest, VercelResponse } from '@vercel/node';

const CTRADER_TOKEN_URL = 'https://openapi.ctrader.com/apps/token';

const CLIENT_ID = process.env.VITE_CTRADER_CLIENT_ID || process.env.CTRADER_CLIENT_ID || '';
const CLIENT_SECRET = process.env.VITE_CTRADER_CLIENT_SECRET || process.env.CTRADER_CLIENT_SECRET || '';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const code = req.query.code as string;
  const redirectUri = req.query.redirect_uri as string;

  if (!code || !redirectUri) {
    res.status(400).json({ error: 'Missing code or redirect_uri' });
    return;
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    res.status(500).json({ error: 'cTrader OAuth credentials not configured' });
    return;
  }

  try {
    const tokenUrl = new URL(CTRADER_TOKEN_URL);
    tokenUrl.searchParams.set('grant_type', 'authorization_code');
    tokenUrl.searchParams.set('code', code);
    tokenUrl.searchParams.set('redirect_uri', redirectUri);
    tokenUrl.searchParams.set('client_id', CLIENT_ID);
    tokenUrl.searchParams.set('client_secret', CLIENT_SECRET);

    const tokenRes = await fetch(tokenUrl.toString(), {
      headers: { Accept: 'application/json' },
    });

    const rawText = await tokenRes.text();
    let body: any;
    try { body = JSON.parse(rawText); } catch { body = {}; }

    if (!tokenRes.ok) {
      const errMsg = body?.description || body?.error_description || body?.error || rawText;
      console.error('cTrader exchange HTTP error:', tokenRes.status, errMsg);
      res.status(502).json({
        error: errMsg || 'Token exchange failed',
        status: tokenRes.status,
        details: body,
      });
      return;
    }

    // cTrader sometimes returns HTTP 200 with an errorCode field
    if (body.errorCode) {
      const errMsg = body.description || body.errorCode;
      console.error('cTrader exchange errorCode:', body.errorCode, body.description);
      res.status(400).json({ error: errMsg, errorCode: body.errorCode });
      return;
    }

    res.json({
      accessToken: body.accessToken,
      refreshToken: body.refreshToken,
      expiresIn: body.expiresIn,
    });
  } catch (err) {
    console.error('cTrader exchange error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Exchange failed',
    });
  }
}
