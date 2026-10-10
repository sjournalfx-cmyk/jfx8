import type { VercelRequest, VercelResponse } from '@vercel/node';
import { persistRotatedCtraderToken } from '../_lib/jfxApiKey.js';
import { requireUser } from '../_lib/auth.js';

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
  return parsed.pathname === '/api/ctrader/callback';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

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

  const auth = await requireUser(req.headers);
  if (!auth.ok || !auth.userId) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  const { clientId, clientSecret } = getCredentials();
  if (!clientId || !clientSecret) {
    const missing = [!clientId && 'CTRADER_CLIENT_ID', !clientSecret && 'CTRADER_CLIENT_SECRET']
      .filter(Boolean);
    console.error('[cTrader] Missing production OAuth configuration:', missing.join(', '));
    res.status(503).json({
      error: 'cTrader OAuth is not configured for this deployment',
      code: 'ctrader_oauth_not_configured',
      missing,
    });
    return;
  }

  // Fail fast BEFORE burning the single-use authorization code: persisting
  // the rotated refresh token requires the service-role key. Previously the
  // code exchanged with cTrader first and only then discovered the DB was
  // unreachable, surfacing as "Could not securely save the cTrader
  // connection" and forcing the user to re-authorize from scratch.
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!supabaseUrl || !serviceKey) {
    const missing = [!supabaseUrl && 'SUPABASE_URL', !serviceKey && 'SUPABASE_SERVICE_ROLE_KEY']
      .filter(Boolean);
    console.error('[cTrader] Exchange: missing database configuration:', missing.join(', '));
    res.status(503).json({
      error: 'cTrader connection cannot be saved: server database is not configured. Please try again later.',
      code: 'ctrader_db_not_configured',
      missing,
    });
    return;
  }

  try {
    const tokenUrl = new URL(CTRADER_TOKEN_URL);
    tokenUrl.searchParams.set('grant_type', 'authorization_code');
    tokenUrl.searchParams.set('code', code);
    tokenUrl.searchParams.set('redirect_uri', redirectUri);
    tokenUrl.searchParams.set('client_id', clientId);
    tokenUrl.searchParams.set('client_secret', clientSecret);

    const tokenRes = await fetch(tokenUrl.toString(), {
      headers: { Accept: 'application/json' },
    });

    const rawText = await tokenRes.text();
    let body: any;
    try { body = JSON.parse(rawText); } catch { body = {}; }

    if (!tokenRes.ok) {
      const errMsg = body?.description || body?.error_description || body?.error || rawText;
      console.error('cTrader exchange HTTP error:', tokenRes.status);
      res.status(502).json({
        error: errMsg || 'Token exchange failed',
        status: tokenRes.status,
        details: body,
      });
      return;
    }

    if (body.errorCode) {
      const errMsg = body.description || body.errorCode;
      console.error('cTrader exchange errorCode:', body.errorCode, body.description);
      res.status(400).json({ error: errMsg, errorCode: body.errorCode });
      return;
    }

    if (!body.accessToken || !body.refreshToken) {
      res.status(502).json({ error: 'cTrader exchange returned an incomplete token response' });
      return;
    }

    const expiresIn = Number(body.expiresIn || body.expires_in);
    try {
      await persistRotatedCtraderToken({
        supabaseUrl,
        serviceKey,
        userId: auth.userId,
        newRefreshToken: String(body.refreshToken),
        newAccessToken: String(body.accessToken),
        accessTokenExpiresAt: new Date(Date.now() + (Number.isFinite(expiresIn) ? Math.max(60, expiresIn) : 300) * 1000).toISOString(),
      });
    } catch (error) {
      console.error('[cTrader] Exchange: failed to persist token', error);
      res.status(503).json({
        error: 'Could not securely save the cTrader connection. Please try again.',
        code: 'ctrader_persist_failed',
        detail: error instanceof Error ? error.message : 'persistence failed',
      });
      return;
    }

    res.setHeader('Set-Cookie', [
      `${REFRESH_COOKIE}=${encodeURIComponent(String(body.refreshToken))}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=31536000`,
    ]);

    // Access and refresh tokens remain server-side. The web client needs only
    // confirmation because subsequent broker calls use its Supabase session.
    res.json({ ok: true });
  } catch (err) {
    console.error('cTrader exchange error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Exchange failed',
    });
  }
}
