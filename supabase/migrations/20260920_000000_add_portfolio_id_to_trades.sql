-- Multi-portfolio support: persist the client-side portfolio assignment server-side.
-- Until now portfolio_id lived only in a localStorage overlay (jfx_trade_portfolios_<userId>),
-- so an APK reinstall / WebView data clear / overlay-cap overflow silently "wiped"
-- cTrader/bridge imports from every non-default portfolio. This column makes the
-- assignment durable; the overlay remains as a fallback for rows written before it.
ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS portfolio_id text;

-- portfolio_id is plain client-generated text (local ids like 'default' or
-- offline UUIDs) with NO portfolios table behind it. A foreign key here
-- rejects every write carrying an assignment, so drop any stray one.
ALTER TABLE public.trades
  DROP CONSTRAINT IF EXISTS trades_portfolio_id_fkey;

-- Journal reads are user-scoped + newest-first; keep the portfolio filter cheap.
CREATE INDEX IF NOT EXISTS trades_user_portfolio_date_idx
  ON public.trades (user_id, portfolio_id, date DESC)
  WHERE deleted_at IS NULL;
