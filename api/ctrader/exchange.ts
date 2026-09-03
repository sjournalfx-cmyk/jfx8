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
  const authHeader = (req.headers['authorization'] || '') as string;
  const supabaseJwt = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!code || !redirectUri) {
    res.status(400).json({ error: 'Missing code or redirect_uri' });
    return;
  }

  if (!isAllowedRedirectUri(redirectUri)) {
    console.error(`[cTrader] Rejected redirect_uri: ${redirectUri}`);
    res.status(400).json({ error: 'Invalid redirect_uri' });
    return;
  }

  const { clientId, clientSecret } = getCredentials();
  if (!clientId || !clientSecret) {
    const missing = [!clientId && 'CTRADER_CLIENT_ID', !clientSecret && 'CTRADER_CLIENT_SECRET']
      .filter(Boolean);
    console.error('[cTrader] Missing production OAuth configuration:', missing.join(', '));
    res.status(503).json({
      error: 'cTrader OAuth is not configured for this deployment',
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

    if (!body.accessToken) {
      res.status(502).json({ error: 'cTrader exchange returned no access token' });
      return;
    }

    if (body.refreshToken) {
      res.setHeader('Set-Cookie', [
        `${REFRESH_COOKIE}=${encodeURIComponent(String(body.refreshToken))}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=31536000`,
      ]);

      let userId = typeof req.query.user_id === 'string' ? req.query.user_id.trim() : undefined;
      if (!userId && supabaseJwt) {
        try {
          const parts2 = supabaseJwt.split('.');
          const pb64 = parts2[1] || '';
          let payload: any = {};
          try { payload = JSON.parse(Buffer.from(pb64, 'base64url').toString('utf8')); } catch { try { const pad = pb64 + '='.repeat((4 - pb64.length % 4) % 4); const b64 = pad.replace(/-/g, '+').replace(/_/g, '/'); payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')); } catch {} }
          userId = payload.sub as string | undefined;
        } catch {}
      }

      if (userId) {
        const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
        try {
          await persistRotatedCtraderToken({
            supabaseUrl,
            serviceKey,
            userId,
            newRefreshToken: String(body.refreshToken),
          });
          console.log(`[cTrader] Exchange: persisted token for user ${userId}`);
        } catch (e: any) {
          console.error('[cTrader] Exchange: failed to persist token', e?.message);
        }
      } else {
        console.warn('[cTrader] Exchange: no userId found in request, token only saved to cookie');
      }
    }

    res.json({
      accessToken: body.accessToken,
      expiresIn: body.expiresIn,
      refreshToken: body.refreshToken,
    });
  } catch (err) {
    console.error('cTrader exchange error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Exchange failed',
    });
  }
}
