-- Harvest queue: refresh the stalest series first and recover dead rows.
--
-- Background: the harvester processes one bounded batch per tick (default 15
-- series). With ~640+ symbol/timeframe rows, claiming ORDER BY id means the
-- tail of the queue can go months without a refresh while the head cycles.
-- Ordering by least-recently-touched first spreads refreshes evenly, so every
-- series' last_bar_time advances each full cycle instead of only the head.
--
-- Also: rows that hit 'error' (5 failed attempts) were never requeued, so a
-- transient outage froze those series forever. Reclaim error rows older than
-- 24h so they retry with backoff instead of dying permanently.

CREATE OR REPLACE FUNCTION public.claim_harvest_jobs(p_limit integer)
RETURNS SETOF public.harvest_queue
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH candidates AS (
    SELECT id
    FROM public.harvest_queue
    WHERE status = 'pending'
       OR (status = 'processing' AND claimed_at < now() - interval '15 minutes')
       OR (status = 'error' AND updated_at < now() - interval '24 hours')
    ORDER BY updated_at ASC NULLS FIRST, id
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
