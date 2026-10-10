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
// NOTE on cadence: ONE tick processes ONE batch (default 50 series, hard max
// 50, plus a 45s time-budget guard). With ~1100 series in the queue a full
// refresh cycle takes ~22 daily ticks — or under a day with the healthy
// 15-minute external pinger. Claims are stalest-first so every series
// advances each cycle.
//
// Env required:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   CTRADER_CLIENT_ID, CTRADER_CLIENT_SECRET
//   CTRADER_SERVICE_REFRESH_TOKEN, CTRADER_SERVICE_ACCOUNT_ID
// Auth (either is accepted, fail-closed if neither secret is set):
//   Vercel cron  -> GET  + Authorization: Bearer <CRON_SECRET>
//   ext. pinger  -> POST + x-harvest-secret: <HARVEST_SECRET>
// Optional:
//   CTRADER_SERVICE_IS_DEMO (default true)
//   HARVEST_TIMEFRAMES (default "M1,M5,M15,M30,H1,H4,D1")
//   HARVEST_BATCH_SIZE (default 50, max 50 — see TIME_BUDGET_MS guard below)

const MAX_BARS_PER_SERIES = 2000;
// Ask the broker for slightly MORE than we store: cTrader occasionally
// returns one fewer trendbar than requested (1999 for count=2000 — seen live
// on EURUSD/M15, XAUUSD/H1, GBPUSD/H1, …), which then freezes into the stored
// series forever because top-ups only append NEWER bars and the cap only
// trims. The buffer is discarded by capToNewest below; storage stays 2000.
const FETCH_COUNT = MAX_BARS_PER_SERIES + 100;
// Upper bound on per-tick work: with big batches a slow broker could push the
// run past the serverless timeout (process killed mid-batch, claimed jobs
// stuck 'processing' until reclaim). Unprocessed claims are reset to pending
// so the next tick retries them immediately instead of after 15 minutes.
const TIME_BUDGET_MS = 45000;

// Vercel invokes cron routes with GET + `Authorization: Bearer CRON_SECRET`.
// The external high-frequency pinger (cron-job.org, Vercel Hobby crons are
// daily-only) uses POST + `x-harvest-secret: HARVEST_SECRET` per the runbook.
// Accept both; fail closed so the harvester is never public.
function authorized(req: VercelRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization === `Bearer ${cronSecret}`) return true;
  const harvestSecret = process.env.HARVEST_SECRET;
  const provided = req.headers['x-harvest-secret'];
  const headerValue = Array.isArray(provided) ? provided[0] : provided;
  if (harvestSecret && headerValue === harvestSecret) return true;
  return false;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!authorized(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const supabaseUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl || !supabaseKey) {
    res.status(503).json({ error: 'Supabase service credentials not configured' });
    return;
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Overlap guard — checked BEFORE minting: cTrader invalidates the previous
  // refresh token on every mint, so two concurrent runs kill each other (the
  // second mint burns the first run's token mid-flight and both batches fail).
  // Bail out early when another run claimed jobs within the claim window.
  const { count: activeRuns } = await supabase
    .from('harvest_queue')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'processing')
    .gt('claimed_at', new Date(Date.now() - 14 * 60 * 1000).toISOString());
  if ((activeRuns ?? 0) > 0) {
    res.status(200).json({ ok: true, processed: 0, remaining: 0, note: 'another harvest run is active; skipping to protect token rotation' });
    return;
  }

  let session: Awaited<ReturnType<typeof createServiceSession>> | null = null;
  try {
    // 1. Queue setup: missing pairs are seeded every tick (see below); done
    //    rows are requeued on drain so each cycle refreshes every series.
    const timeframes = (process.env.HARVEST_TIMEFRAMES || 'M1,M5,M15,M30,H1,H4,D1').split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
    const batchSize = Math.min(50, Math.max(1, Number(process.env.HARVEST_BATCH_SIZE || 50)));

    session = await createServiceSession({
      loadRotatedToken: async () => {
        const { data } = await supabase.from('service_config').select('value').eq('key', 'ctrader_service_refresh_token').maybeSingle();
        return data?.value || null;
      },
      saveRotatedToken: async (token) => {
        await supabase.from('service_config').upsert({ key: 'ctrader_service_refresh_token', value: token }, { onConflict: 'key' });
      },
    });

    // Always ensure every symbol×timeframe pair exists (cheap no-op when the
    // queue is complete). This runs EVERY tick — not just on empty queue — so
    // newly added timeframes (e.g. M1/M5/M30) seed immediately instead of
    // waiting for a full drain that may never come while rows stay pending.
    const targets = await listSymbols(session);
    const seedRows = targets.flatMap(t => timeframes.map(tf => ({
      symbol: t.symbolName,
      symbol_id: t.symbolId,
      digits: t.digits,
      timeframe: tf,
    })));
    if (seedRows.length > 0) {
      // upsert ignores duplicates thanks to unique(symbol_id, timeframe)
      const { error: seedError } = await supabase.from('harvest_queue').upsert(seedRows, { onConflict: 'symbol_id,timeframe', ignoreDuplicates: true });
      if (seedError) throw seedError;
    }

    let { data: queue, error: claimError } = await supabase
      .rpc('claim_harvest_jobs', { p_limit: batchSize });
    if (claimError) throw claimError;

    if (!queue || queue.length === 0) {
      // A completed queue is a refresh cycle, not a terminal state. Requeue
      // completed rows before claiming the next bounded batch; otherwise the
      // unique(symbol_id,timeframe) insert below would leave every existing
      // row "done" forever and candles would never refresh again.
      const { error: requeueError } = await supabase
        .from('harvest_queue')
        .update({ status: 'pending', claimed_at: null, attempts: 0, updated_at: new Date().toISOString() })
        .eq('status', 'done');
      if (requeueError) throw requeueError;

      ({ data: queue, error: claimError } = await supabase
        .rpc('claim_harvest_jobs', { p_limit: batchSize }));
      if (claimError) throw claimError;
    }

    if (!queue || queue.length === 0) {
      closeSession(session);
      res.status(200).json({ ok: true, processed: 0, remaining: 0, note: 'queue empty or fully seeded' });
      return;
    }

    // 2. Process each queued item.
    const startedAt = Date.now();
    let processed = 0;
    let timeCapped = false;
    const errors: string[] = [];
    for (let i = 0; i < queue.length; i++) {
      const job = queue[i];
      try {
        const target = { symbolName: job.symbol, symbolId: job.symbol_id, digits: job.digits };
        const incoming = await fetchTrendbarsServer(session, target, job.timeframe, { count: FETCH_COUNT });

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

        await supabase.from('harvest_queue').update({
          status: 'done',
          claimed_at: null,
          attempts: 0,
          updated_at: new Date().toISOString(),
        }).eq('id', job.id);
        processed++;
      } catch (err: any) {
        errors.push(`${job.symbol}/${job.timeframe}: ${String(err?.message || err)}`);
        await supabase.from('harvest_queue').update({
          status: Number(job.attempts || 0) >= 5 ? 'error' : 'pending',
          claimed_at: null,
          updated_at: new Date().toISOString(),
        }).eq('id', job.id);
        break; // stop batch on first failure — likely auth/rate-limit related
      }
      // Time budget: stop before the serverless timeout kills the run
      // mid-batch. Claims left 'processing' would sit until the 15-min
      // reclaim, so reset the unprocessed tail to pending for the next tick.
      if (Date.now() - startedAt > TIME_BUDGET_MS && i < queue.length - 1) {
        const restIds = queue.slice(i + 1).map((j: any) => j.id);
        await supabase.from('harvest_queue').update({
          status: 'pending',
          claimed_at: null,
          updated_at: new Date().toISOString(),
        }).in('id', restIds);
        timeCapped = true;
        break;
      }
    }

    const { count: remaining } = await supabase
      .from('harvest_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');

    closeSession(session);
    res.status(200).json({ ok: errors.length === 0, processed, remaining: remaining ?? 0, errors, timeCapped });
  } catch (err: any) {
    closeSession(session);
    res.status(500).json({ error: String(err?.message || err) });
  }
}
