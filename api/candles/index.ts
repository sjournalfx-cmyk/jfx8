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

  // Keep the response lean: metadata always, full bars only when fresh/asked.
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.status(200).json({
    symbol: row.symbol,
    timeframe: row.timeframe,
    bar_count: row.bar_count,
    last_bar_time: row.last_bar_time,
    digits: row.digits,
    updated_at: row.updated_at,
    bars,
  });
}
