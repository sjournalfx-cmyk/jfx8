-- reconcile_orphan_portfolios.sql — one-off data cleanup for the
-- "app shows 2 portfolios, trades reference 6" discrepancy.
--
-- Background:
-- * trades.portfolio_id is plain client-generated text (no FK by design —
--   see 20260920_000000_add_portfolio_id_to_trades.sql). Portfolios were
--   historically created per-device; uninstalls/reconnects left stale ids.
-- * Agents reported 6 distinct portfolio_ids across 74 trades while the app
--   surfaces 2, plus 1 trade with portfolio_id NULL.
--
-- Policy (user-approved): NULL out orphaned ids (they stop polluting
-- analytics/grouping; the app's overlay re-assigns them if users file those
-- trades again), and backfill NULL portfolio_id rows to the user's default
-- portfolio when one exists.
--
-- Idempotent, and safe to re-run: both steps are conditional updates.
-- Run inside a transaction; prints before/after counts as commit markers.

BEGIN;

-- ---------------------------------------------------------------------------
-- Step 0 — snapshot of the damage (visible in the transaction output).
-- ---------------------------------------------------------------------------
WITH refs AS (
  SELECT t.user_id, t.portfolio_id, count(*) AS trades
  FROM public.trades t
  WHERE t.deleted_at IS NULL AND t.portfolio_id IS NOT NULL
  GROUP BY 1, 2
)
SELECT r.user_id, r.portfolio_id, r.trades,
       (exists (
         SELECT 1 FROM public.portfolios p
         WHERE p.id::text = r.portfolio_id AND p.user_id = r.user_id
       )) AS registered
FROM refs r
ORDER BY r.user_id, r.trades DESC;

-- ---------------------------------------------------------------------------
-- Step 1 — NULL out portfolio_id values whose target portfolio row is gone
-- (not is_archived guards: archived portfolios still own their trades).
-- ---------------------------------------------------------------------------
UPDATE public.trades t
SET portfolio_id = NULL, updated_at = now()
WHERE t.deleted_at IS NULL
  AND t.portfolio_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.portfolios p
    WHERE p.id::text = t.portfolio_id AND p.user_id = t.user_id
  );

-- ---------------------------------------------------------------------------
-- Step 2 — backfill rows with portfolio_id NULL to the user's default
-- portfolio (only when one exists and is not archived).
-- ---------------------------------------------------------------------------
WITH def AS (
  SELECT DISTINCT ON (p.user_id) p.user_id, p.id::text AS default_pid
  FROM public.portfolios p
  WHERE p.is_default AND NOT p.is_archived
  ORDER BY p.user_id, p.created_at ASC
)
UPDATE public.trades t
SET portfolio_id = def.default_pid::uuid, updated_at = now()  -- column is uuid on the live DB
FROM def
WHERE t.user_id = def.user_id
  AND t.deleted_at IS NULL
  AND t.portfolio_id IS NULL;

-- ---------------------------------------------------------------------------
-- Step 3 — mirror the same cleanup onto the orphaned portfolio_locks rows so
-- /v1/locks listings never dangle either.
-- ---------------------------------------------------------------------------
DELETE FROM public.portfolio_locks pl
WHERE pl.portfolio_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.portfolios p
    WHERE p.id::text = pl.portfolio_id AND p.user_id = pl.user_id
  );

COMMIT;
