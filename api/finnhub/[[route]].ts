import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCorsHeaders } from '../_lib/cors.js';
import { requireUser } from '../_lib/auth.js';
import { rateLimit } from '../_lib/rateLimit.js';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

const ENDPOINT_MAP: Record<string, string> = {
  'market-news': '/news',
  'company-news': '/company-news',
  'insider-transactions': '/stock/insider-transactions',
  'analyst-recommendations': '/stock/recommendation',
  'economic-calendar': '/calendar/economic',
  'sec-filings': '/stock/filings',
  'earnings-surprises': '/stock/earnings',
  'peer-companies': '/stock/peers',
  'market-status': '/stock/market-status',
};

const SYMBOL_REQUIRED = ['company-news', 'insider-transactions', 'analyst-recommendations', 'sec-filings', 'earnings-surprises', 'peer-companies'];

const getSingle = (value: string | string[] | undefined) => (
  Array.isArray(value) ? value[0] : value
);

const getFinnhubErrorMessage = (status: number) => {
  if (status === 401) return 'Finnhub rejected the API key with 401 Unauthorized. Verify the key is active.';
  if (status === 403) return 'This endpoint requires a paid Finnhub plan.';
  if (status === 429) return 'Finnhub rate limit reached. Wait a moment and try again.';
  return `Finnhub returned HTTP ${status}.`;
};

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

  // Require an authenticated Supabase user so this paid proxy cannot be
  // abused anonymously — CORS restricts browsers only, not curl/scripts.
  const auth = await requireUser(req.headers);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  // Per-user rate limit (Finnhub free tier allows 60 req/min).
  const rl = rateLimit(`finnhub:${auth.userId}`, 30, 60_000);
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(Math.ceil((rl.retryAfterMs ?? 0) / 1000)));
    res.status(429).json({ error: 'Rate limit exceeded. Please slow down and try again in a moment.' });
    return;
  }

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Missing FINNHUB_API_KEY environment variable' });
    return;
  }

  const suffix = getSingle(req.query?.route);
  const endpoint = suffix ? ENDPOINT_MAP[suffix] : undefined;

  if (!suffix || !endpoint) {
    res.status(404).json({ error: `Unknown Finnhub route: ${suffix}` });
    return;
  }

  if (SYMBOL_REQUIRED.includes(suffix)) {
    const symbol = getSingle(req.query?.symbol);
    if (!symbol) {
      res.status(400).json({ error: 'Missing required query param: symbol' });
      return;
    }
  }

  const params = new URLSearchParams({ token: apiKey });
  if (req.query) {
    for (const [key, value] of Object.entries(req.query)) {
      if (key !== 'token' && key !== 'route') {
        params.set(key, getSingle(value));
      }
    }
  }

  try {
    const upstream = await fetch(`${FINNHUB_BASE}${endpoint}?${params.toString()}`);
    const payload = await upstream.json().catch(() => null);

    if (!upstream.ok) {
      res.status(upstream.status).json({
        error: getFinnhubErrorMessage(upstream.status),
        status: upstream.status,
      });
      return;
    }

    res.status(200).json({ data: payload });
  } catch (error) {
    console.error('Finnhub proxy error:', error);
    res.status(500).json({
      error: 'Failed to fetch Finnhub data',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
