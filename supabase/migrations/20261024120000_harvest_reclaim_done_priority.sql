-- Harvest queue: reclaim 'done' rows so every series keeps refreshing.
--
-- Root cause of the stale candle store: claim_harvest_jobs only looked at
-- pending / stale processing / old error rows, and harvest.ts only requeued
-- 'done' rows when the queue was COMPLETELY empty. With a permanent backlog of
-- pending rows, 'done' series were never claimed again (636 of 1079 series
-- older than 30 days in production).
--
-- New claim order:
--   1. pending rows (new work / retries) first
--   2. done rows, ordered by candle_series.updated_at oldest first
--   3. recovered processing/error rows as a safety net
-- Within each bucket the popular symbols and timeframes are preferred so the
-- Backtest Lab's default pairs stay fresh even when the full cycle is slow.

CREATE OR REPLACE FUNCTION public.claim_harvest_jobs(p_limit integer)
RETURNS SETOF public.harvest_queue
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH candidates AS (
    SELECT id
    FROM public.harvest_queue AS q
    WHERE q.status = 'pending'
       OR q.status = 'done'
       OR (q.status = 'processing' AND q.claimed_at < now() - interval '15 minutes')
       OR (q.status = 'error' AND q.updated_at < now() - interval '24 hours')
    ORDER BY
      CASE q.status
        WHEN 'pending' THEN 0
        WHEN 'done' THEN 1
        ELSE 2
      END,
      -- Pending only: popular Backtest Lab symbols first. Done rows are
      -- ordered purely by staleness below, otherwise freshly harvested
      -- popular series would be re-claimed every tick and starve the rest.
      CASE
        WHEN q.status <> 'pending' THEN 0
        WHEN upper(regexp_replace(q.symbol, '[^A-Za-z0-9]', '', 'g')) IN (
          'EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'US30', 'NAS100',
          'GBPJPY', 'AUDUSD', 'USDCAD', 'BTCUSD'
        ) THEN 0
        ELSE 1
      END,
      -- Pending only: most-used timeframes first.
      CASE WHEN q.status <> 'pending' THEN 0 ELSE CASE q.timeframe
        WHEN 'M15' THEN 0
        WHEN 'H1' THEN 1
        WHEN 'H4' THEN 2
        WHEN 'D1' THEN 3
        ELSE 4
      END END,
      -- Least recently harvested series first. Missing series are the oldest.
      COALESCE((
        SELECT cs.updated_at
        FROM public.candle_series AS cs
        WHERE cs.symbol = q.symbol
          AND cs.timeframe = q.timeframe
      ), 'epoch'::timestamptz) ASC,
      -- Tie-break: popular pairs and timeframes first among equally stale rows.
      CASE WHEN upper(regexp_replace(q.symbol, '[^A-Za-z0-9]', '', 'g')) IN (
        'EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'US30', 'NAS100',
        'GBPJPY', 'AUDUSD', 'USDCAD', 'BTCUSD') THEN 0 ELSE 1 END,
      q.id
    FOR UPDATE SKIP LOCKED
    LIMIT least(greatest(p_limit, 1), 50)
  )
  UPDATE public.harvest_queue AS queue
  SET status = 'processing',
      claimed_at = now(),
      attempts = queue.attempts + 1,
      updated_at = now()
  FROM candidates
  WHERE queue.id = candidates.id
  RETURNING queue.*;
$$;

REVOKE ALL ON FUNCTION public.claim_harvest_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_harvest_jobs(integer) TO service_role;
