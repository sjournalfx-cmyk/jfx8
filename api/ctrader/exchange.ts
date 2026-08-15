import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCorsHeaders } from '../_lib/cors';

const CTRADER_TOKEN_URL = 'https://openapi.ctrader.com/apps/token';
const REFRESH_COOKIE = 'jfx_ctrader_refresh';

// Server-only credentials. Never hardcode or fall back to client VITE_* values:
// the client secret must never be shipped to the browser.
const CLIENT_ID = process.env.CTRADER_CLIENT_ID || '';
const CLIENT_SECRET = process.env.CTRADER_CLIENT_SECRET || '';

// Exact-match allowlist for redirect_uri hosts (port stripped). Suffix matching
// (e.g. "endsWith('.vercel.app')") and trusting the Host / x-forwarded-host
// header are both rejected because they allow attackers to intercept OAuth codes.
const DEFAULT_ALLOWED_REDIRECT_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  'jfxjournal.site',
  'www.jfxjournal.site',
]);

function getAllowedRedirectHosts(): Set<string> {
  const fromEnv = (process.env.CTRADER_ALLOWED_REDIRECT_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_REDIRECT_HOSTS, ...fromEnv]);
}

function isAllowedRedirectUri(redirectUri: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (!getAllowedRedirectHosts().has(parsed.hostname.toLowerCase())) return false;
  // Bind the redirect to the app's own callback path so an attacker cannot
  // point the code at an arbitrary path on an allowed host.
  return parsed.pathname === '/api/ctrader/callback';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCorsHeaders(res, req.headers);
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

  if (!isAllowedRedirectUri(redirectUri)) {
    console.error(`[cTrader] Rejected redirect_uri: ${redirectUri}`);
    res.status(400).json({ error: 'Invalid redirect_uri' });
    return;
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    res.status(500).json({ error: 'cTrader OAuth credentials not configured on the server' });
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

    if (!body.accessToken) {
      res.status(502).json({ error: 'cTrader exchange returned no access token' });
      return;
    }

    // Store the long-lived refresh token in an httpOnly cookie so it is not
    // readable by JavaScript (mitigates XSS token theft). The access token is
    // returned to the client and kept in memory only.
    if (body.refreshToken) {
      res.setHeader('Set-Cookie', [
        `${REFRESH_COOKIE}=${encodeURIComponent(String(body.refreshToken))}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=31536000`,
      ]);
    }

    res.json({
      accessToken: body.accessToken,
      expiresIn: body.expiresIn,
    });
  } catch (err) {
    console.error('cTrader exchange error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Exchange failed',
    });
  }
}
