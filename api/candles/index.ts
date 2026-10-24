import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// Public read proxy for the shared candle store. Lets the Backtest Lab load
// charts with NO personal cTrader connection.
//
// GET /api/candles?symbol=EURUSD&timeframe=H1&since=<unixSeconds>
//   `since` returns only bars newer than the caller's newest local bar
//   (incremental top-up). Response 404s when the harvester hasn't reached
//   that series yet.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const TIMEFRAME_SECONDS: Record<string, number> = {
  M1: 60, M2: 120, M3: 180, M4: 240, M5: 300, M10: 600,
  M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400,
  W1: 604800, MN1: 2592000,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const symbol = String(req.query.symbol || '').toUpperCase().replace(/[/_]/g, '');
  const timeframe = String(req.query.timeframe || '').toUpperCase();
  const since = Number(req.query.since || 0);
  if (!symbol || !timeframe) {
    res.status(400).json({ error: 'symbol and timeframe are required' });
    return;
  }

  const supabaseUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
  if (!supabaseUrl || !supabaseKey) {
    res.status(503).json({ error: 'Supabase credentials not configured' });
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const { data, error } = await supabase
    .from('candle_series')
    .select('symbol,timeframe,bars,bar_count,last_bar_time,digits,updated_at')
    .eq('symbol', symbol)
    .eq('timeframe', timeframe)
    .limit(1);

  if (error) { res.status(500).json({ error: error.message }); return; }
  const row = data?.[0];
  if (!row) { res.status(404).json({ error: 'not_found' }); return; }

  const bars = Array.isArray(row.bars)
    ? (since > 0 ? row.bars.filter((b: any) => Number(b?.time) > since) : row.bars)
    : [];

  // Staleness is relative to the bar interval: a daily series is still fresh
  // for two days, while M1 is stale after two minutes. Anything untouched for
  // >24h is always stale so a broken harvester can never look healthy.
  const updatedMs = Date.parse(String(row.updated_at || ''));
  const ageMs = Number.isFinite(updatedMs) ? Math.max(0, Date.now() - updatedMs) : null;
  const tfMs = (TIMEFRAME_SECONDS[timeframe] || 3600) * 1000;
  const stale = ageMs === null || ageMs > 2 * tfMs || ageMs > 24 * 60 * 60 * 1000;

  // Keep the response lean: metadata always, full bars only when fresh/asked.
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.status(200).json({
    symbol: row.symbol,
    timeframe: row.timeframe,
    bar_count: row.bar_count,
    last_bar_time: row.last_bar_time,
    digits: row.digits,
    updated_at: row.updated_at,
    stale,
    age_hours: ageMs === null ? null : Number((ageMs / 3_600_000).toFixed(1)),
    bars,
  });
}
