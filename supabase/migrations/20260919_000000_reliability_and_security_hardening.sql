-- Atomic trade identity, stale-write protection, durable rate limits, and
-- concurrent-safe candle-harvest job claiming.

-- A retry or two browser tabs can otherwise insert the same broker ticket.
-- Preserve the earliest active row and soft-delete later duplicate rows before
-- adding the partial uniqueness guarantee.
WITH ranked_tickets AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, ticket_id
           ORDER BY created_at NULLS LAST, id
         ) AS row_number
  FROM public.trades
  WHERE ticket_id IS NOT NULL
    AND deleted_at IS NULL
)
UPDATE public.trades AS trade
SET deleted_at = now()
FROM ranked_tickets AS ranked
WHERE trade.id = ranked.id
  AND ranked.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS trades_user_ticket_active_unique
  ON public.trades (user_id, ticket_id)
  WHERE ticket_id IS NOT NULL AND deleted_at IS NULL;

-- Match the journal's user-scoped, newest-first reads and reduce full-table
-- scans as data grows.
CREATE INDEX IF NOT EXISTS trades_user_active_date_idx
  ON public.trades (user_id, date DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS notes_user_created_idx
  ON public.notes (user_id, created_at DESC);
-- cash_transactions only exists if 20260419 was applied; skip gracefully
-- on databases that never created the cash-journal table.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'cash_transactions'
  ) THEN
    CREATE INDEX IF NOT EXISTS cash_transactions_user_date_idx
      ON public.cash_transactions (user_id, date DESC);
  END IF;
END
$$;

ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- The function already exists in earlier migrations. Recreate these triggers
-- explicitly so stale tabs cannot pass an old updated_at revision twice.
DROP TRIGGER IF EXISTS handle_updated_at_trades ON public.trades;
CREATE TRIGGER handle_updated_at_trades
  BEFORE UPDATE ON public.trades
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS handle_updated_at_notes ON public.notes;
CREATE TRIGGER handle_updated_at_notes
  BEFORE UPDATE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- A serverless in-memory limiter is per-instance. This small RLS-protected
-- table and service-only RPC give every function invocation one atomic limit.
CREATE TABLE IF NOT EXISTS public.api_proxy_rate_limits (
  rate_key text NOT NULL,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  PRIMARY KEY (rate_key, window_start)
);

ALTER TABLE public.api_proxy_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.consume_proxy_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
RETURNS TABLE (allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_window timestamptz;
  current_count integer;
BEGIN
  IF p_key IS NULL OR length(p_key) = 0 OR p_limit < 1 OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'invalid rate limit arguments';
  END IF;

  current_window := to_timestamp(
    floor(extract(epoch FROM clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO public.api_proxy_rate_limits AS limits (rate_key, window_start, request_count)
  VALUES (p_key, current_window, 1)
  ON CONFLICT (rate_key, window_start) DO UPDATE
    SET request_count = limits.request_count + 1
    WHERE limits.request_count < p_limit
  RETURNING request_count INTO current_count;

  IF current_count IS NULL THEN
    RETURN QUERY SELECT false,
      greatest(1, ceil(extract(epoch FROM (current_window + make_interval(secs => p_window_seconds) - clock_timestamp())))::integer);
  ELSE
    RETURN QUERY SELECT true, 0;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_proxy_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_proxy_rate_limit(text, integer, integer) TO service_role;

-- Keep short-lived broker access tokens server-side to avoid consuming the
-- single-use refresh token for every request. RLS on this table already
-- prevents client reads.
ALTER TABLE public.user_ctrader_tokens
  ADD COLUMN IF NOT EXISTS access_token text,
  ADD COLUMN IF NOT EXISTS access_token_expires_at timestamptz;

-- cTrader rotates refresh tokens on use. A short service-only lease prevents
-- two browser tabs or serverless instances from consuming the same token.
CREATE TABLE IF NOT EXISTS public.ctrader_token_refresh_locks (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  locked_until timestamptz NOT NULL
);

ALTER TABLE public.ctrader_token_refresh_locks ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.try_acquire_ctrader_token_refresh_lock(
  p_user_id uuid,
  p_lease_seconds integer DEFAULT 30
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH claimed AS (
    INSERT INTO public.ctrader_token_refresh_locks AS locks (user_id, locked_until)
    VALUES (p_user_id, now() + make_interval(secs => least(greatest(p_lease_seconds, 5), 60)))
    ON CONFLICT (user_id) DO UPDATE
      SET locked_until = EXCLUDED.locked_until
      WHERE locks.locked_until <= now()
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$$;

CREATE OR REPLACE FUNCTION public.release_ctrader_token_refresh_lock(p_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  DELETE FROM public.ctrader_token_refresh_locks WHERE user_id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public.try_acquire_ctrader_token_refresh_lock(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_ctrader_token_refresh_lock(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_acquire_ctrader_token_refresh_lock(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_ctrader_token_refresh_lock(uuid) TO service_role;

-- Harvest jobs are claimed in one transaction, preventing overlapping cron
-- invocations from fetching and writing the same symbol/timeframe pair.
ALTER TABLE public.harvest_queue
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

CREATE INDEX IF NOT EXISTS harvest_queue_claimable_idx
  ON public.harvest_queue (status, claimed_at, id);

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
    ORDER BY id
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
