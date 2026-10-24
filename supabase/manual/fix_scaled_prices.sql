-- Manual repair for cTrader deals whose prices were divided by 10^digits
-- twice (entry/exit/SL/TP stored as e.g. 0.0000056904 instead of 0.56904).
--
-- DO NOT add this to supabase/migrations: it is a one-off data repair that must
-- be reviewed and run by a human in the Supabase SQL editor.
--
-- Safe guards:
--   * Forex only (metals/indices/crypto legitimately have small prices).
--   * Only rows whose entry_price is implausibly small for FX (< 0.001).
--   * Single transaction; run the SELECTs first and keep the output.

BEGIN;

-- 1) Inspect the blast radius before changing anything.
SELECT
  count(*)                                            AS affected_rows,
  min(entry_price)                                    AS min_entry_price,
  max(entry_price)                                    AS max_entry_price,
  min(created_at)                                      AS oldest,
  max(created_at)                                      AS newest
FROM public.trades
WHERE lower(asset_type) = 'forex'
  AND entry_price > 0
  AND entry_price < 0.001;

SELECT id, pair, direction, entry_price, exit_price, stop_loss, take_profit, created_at
FROM public.trades
WHERE lower(asset_type) = 'forex'
  AND entry_price > 0
  AND entry_price < 0.001
ORDER BY created_at DESC
LIMIT 50;

-- 2) Restore the missing tick scale exactly once. JPY pairs use 3 digits,
--    every other FX pair uses 5. Dividing the stored value again would make
--    this worse, so it is gated on the same < 0.001 predicate.
UPDATE public.trades
SET
  entry_price = entry_price * CASE
    WHEN upper(pair) LIKE '%JPY%' THEN 1000
    ELSE 100000
  END,
  exit_price = CASE
    WHEN exit_price IS NOT NULL AND exit_price > 0 AND exit_price < 0.001
      THEN exit_price * CASE WHEN upper(pair) LIKE '%JPY%' THEN 1000 ELSE 100000 END
    ELSE exit_price
  END,
  stop_loss = CASE
    WHEN stop_loss IS NOT NULL AND stop_loss > 0 AND stop_loss < 0.001
      THEN stop_loss * CASE WHEN upper(pair) LIKE '%JPY%' THEN 1000 ELSE 100000 END
    ELSE stop_loss
  END,
  take_profit = CASE
    WHEN take_profit IS NOT NULL AND take_profit > 0 AND take_profit < 0.001
      THEN take_profit * CASE WHEN upper(pair) LIKE '%JPY%' THEN 1000 ELSE 100000 END
    ELSE take_profit
  END,
  updated_at = now()
WHERE lower(asset_type) = 'forex'
  AND entry_price > 0
  AND entry_price < 0.001;

-- 3) Verify nothing is left in the broken range.
SELECT count(*) AS remaining_broken_rows
FROM public.trades
WHERE lower(asset_type) = 'forex'
  AND entry_price > 0
  AND entry_price < 0.001;

COMMIT;
