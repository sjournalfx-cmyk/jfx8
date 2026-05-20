import type { VercelRequest, VercelResponse } from '@vercel/node';

const FMP_BASE = 'https://financialmodelingprep.com/stable';

const ENDPOINT_MAP: Record<string, string> = {
  'quote': '/quote',
  'profile': '/profile',
  'earnings-calendar': '/earnings-calendar',
  'treasury-rates': '/treasury-rates',
  'key-metrics': '/key-metrics-ttm',
  'income-statement': '/income-statement',
  'balance-sheet': '/balance-sheet-statement',
  'cash-flow': '/cash-flow-statement',
  'ratios': '/ratios-ttm',
  'financial-growth': '/financial-growth',
  'price-change': '/stock-price-change',
  'dcf': '/discounted-cash-flow',
};

const SYMBOL_REQUIRED = ['quote', 'profile', 'key-metrics', 'income-statement', 'balance-sheet', 'cash-flow', 'ratios', 'financial-growth', 'price-change', 'dcf'];

const getSingle = (value: string | string[] | undefined) => (
  Array.isArray(value) ? value[0] : value
);

const getFmpErrorMessage = (status: number, details: unknown) => {
  if (status === 401) {
    return 'FMP rejected the API key with 401 Unauthorized. Verify the key is active and has access to this endpoint.';
  }
  if (status === 403 || status === 404) {
    return 'This endpoint requires a paid FMP plan. The free plan provides Quote, Profile, Treasury Rates, and Earnings Calendar.';
  }
  if (status === 429) {
    return 'FMP rate limit reached. Wait a moment and try again.';
  }
  const detailMessage = typeof details === 'object' && details !== null && 'Error Message' in details
    ? String((details as Record<string, unknown>)['Error Message'])
    : typeof details === 'object' && details !== null && 'message' in details
      ? String((details as Record<string, unknown>).message)
      : '';
  return detailMessage || `FMP returned HTTP ${status}.`;
};

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

  const apiKey = process.env.FMP_API_KEY || process.env.VITE_FMP_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Missing FMP_API_KEY environment variable' });
    return;
  }

  const suffix = getSingle(req.query?.route);
  const endpoint = suffix ? ENDPOINT_MAP[suffix] : undefined;

  if (!suffix || !endpoint) {
    res.status(404).json({ error: `Unknown FMP route: ${suffix}` });
    return;
  }

  if (SYMBOL_REQUIRED.includes(suffix)) {
    const symbol = getSingle(req.query?.symbol);
    if (!symbol) {
      res.status(400).json({ error: 'Missing required query param: symbol' });
      return;
    }
  }

  const symbol = getSingle(req.query?.symbol);
  const params = new URLSearchParams({ apikey: apiKey });
  if (req.query) {
    for (const [key, value] of Object.entries(req.query)) {
      if (key !== 'apikey' && key !== 'route') {
        params.set(key, getSingle(value));
      }
    }
  }

  try {
    const upstream = await fetch(`${FMP_BASE}${endpoint}?${params.toString()}`);
    const payload = await upstream.json().catch(() => null);

    if (!upstream.ok) {
      res.status(upstream.status).json({
        error: getFmpErrorMessage(upstream.status, payload),
        status: upstream.status,
        details: payload,
      });
      return;
    }

    res.status(200).json({ data: payload });
  } catch (error) {
    console.error('FMP proxy error:', error);
    res.status(500).json({
      error: 'Failed to fetch FMP data',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
