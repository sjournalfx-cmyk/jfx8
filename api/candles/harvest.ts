import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import {
  createServiceSession,
  listSymbols,
  fetchTrendbarsServer,
  mergeBars,
  capToNewest,
  closeSession,
} from '../_lib/ctraderHarvester.js';

// Cron-driven harvester. Each invocation processes a small bounded batch of
// the persistent harvest_queue so a full backfill completes across many short
// runs (Vercel functions have hard execution-time limits).
//
// Env required:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   CTRADER_CLIENT_ID, CTRADER_CLIENT_SECRET
//   CTRADER_SERVICE_REFRESH_TOKEN, CTRADER_SERVICE_ACCOUNT_ID
// Optional:
//   CTRADER_SERVICE_IS_DEMO (default true)
//   HARVEST_TIMEFRAMES (default "M15,H1,H4,D1")
//   HARVEST_BATCH_SIZE (default 5)

const MAX_BARS_PER_SERIES = 2000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Shared secret so only our cron (or the owner) can trigger harvesting.
function authorized(req: VercelRequest): boolean {
  const secret = process.env.HARVEST_SECRET;
  if (!secret) return true; // not configured — allow (cron URL is unguessable enough for v1)
  const provided = req.headers['x-harvest-secret'] || req.query.secret;
  return String(provided) === secret;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!authorized(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!supabaseUrl || !supabaseKey) {
    res.status(503).json({ error: 'Supabase service credentials not configured' });
    return;
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  let session: Awaited<ReturnType<typeof createServiceSession>> | null = null;
  try {
    // 1. Seed queue when empty (first tick after deploy or after full drain
    //    with a new timeframe set — done rows are re-seeded on demand below).
    const timeframes = (process.env.HARVEST_TIMEFRAMES || 'M15,H1,H4,D1').split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
    const batchSize = Math.max(1, Number(process.env.HARVEST_BATCH_SIZE || 15));

    session = await createServiceSession({
      loadRotatedToken: async () => {
        const { data } = await supabase.from('service_config').select('value').eq('key', 'ctrader_service_refresh_token').maybeSingle();
        return data?.value || null;
      },
      saveRotatedToken: async (token) => {
        await supabase.from('service_config').upsert({ key: 'ctrader_service_refresh_token', value: token }, { onConflict: 'key' });
      },
    });

    let { data: queue } = await supabase
      .from('harvest_queue')
      .select('id, symbol, symbol_id, digits, timeframe')
      .eq('status', 'pending')
      .order('id', { ascending: true })
      .limit(batchSize);

    if (!queue || queue.length === 0) {
      // Queue empty → seed it from the service account's full symbol list.
      const targets = await listSymbols(session);
      const rows = targets.flatMap(t => timeframes.map(tf => ({
        symbol: t.symbolName,
        symbol_id: t.symbolId,
        digits: t.digits,
        timeframe: tf,
      })));
      if (rows.length > 0) {
        // upsert ignores duplicates thanks to unique(symbol_id, timeframe)
        await supabase.from('harvest_queue').upsert(rows, { onConflict: 'symbol_id,timeframe', ignoreDuplicates: true });
      }
      ({ data: queue } = await supabase
        .from('harvest_queue')
        .select('id, symbol, symbol_id, digits, timeframe')
        .eq('status', 'pending')
        .order('id', { ascending: true })
        .limit(batchSize));
    }

    if (!queue || queue.length === 0) {
      closeSession(session);
      res.status(200).json({ ok: true, processed: 0, remaining: 0, note: 'queue empty or fully seeded' });
      return;
    }

    // 2. Process each queued item.
    let processed = 0;
    const errors: string[] = [];
    for (const job of queue) {
      try {
        const target = { symbolName: job.symbol, symbolId: job.symbol_id, digits: job.digits };
        const incoming = await fetchTrendbarsServer(session, target, job.timeframe, { count: MAX_BARS_PER_SERIES });

        const { data: existingRow } = await supabase
          .from('candle_series')
          .select('bars')
          .eq('symbol', job.symbol)
          .eq('timeframe', job.timeframe)
          .maybeSingle();
        const existing = Array.isArray(existingRow?.bars) ? existingRow.bars : null;

        const merged = capToNewest(mergeBars(existing, incoming), MAX_BARS_PER_SERIES);
        const lastBarTime = merged.length > 0 ? merged[merged.length - 1].time : 0;

        const { error: upsertErr } = await supabase.from('candle_series').upsert({
          symbol: job.symbol,
          timeframe: job.timeframe,
          bars: merged,
          bar_count: merged.length,
          last_bar_time: lastBarTime,
          digits: job.digits,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'symbol,timeframe' });
        if (upsertErr) throw upsertErr;

        await supabase.from('harvest_queue').update({ status: 'done', attempts: 0, updated_at: new Date().toISOString() }).eq('id', job.id);
        processed++;
      } catch (err: any) {
        errors.push(`${job.symbol}/${job.timeframe}: ${String(err?.message || err)}`);
        await supabase.from('harvest_queue').update({
          status: 'error',
          updated_at: new Date().toISOString(),
        }).eq('id', job.id);
        break; // stop batch on first failure — likely auth/rate-limit related
      }
    }

    const { count: remaining } = await supabase
      .from('harvest_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');

    closeSession(session);
    res.status(200).json({ ok: errors.length === 0, processed, remaining: remaining ?? 0, errors });
  } catch (err: any) {
    closeSession(session);
    res.status(500).json({ error: String(err?.message || err) });
  }
}
