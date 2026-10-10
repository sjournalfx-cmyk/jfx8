-- Schema sync: bring public.trades in line with what the app reads/writes.
-- Probing the live database showed these columns missing, which broke journal
-- reads (commissions/fees/swap/voice_note), chart loads (chart_candles,
-- chart_timeframe) and discipline sync (checklist_*). Every statement is
-- IF NOT EXISTS, so this is safe to run on any schema vintage — already
-- applied columns are skipped. The app additionally tolerates missing columns
-- at runtime, so old and new clients keep working before/after this lands.
ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS commissions numeric,
  ADD COLUMN IF NOT EXISTS fees numeric,
  ADD COLUMN IF NOT EXISTS swap numeric,
  ADD COLUMN IF NOT EXISTS voice_note text,
  ADD COLUMN IF NOT EXISTS chart_candles jsonb,
  ADD COLUMN IF NOT EXISTS chart_timeframe text,
  ADD COLUMN IF NOT EXISTS checklist_template_id text,
  ADD COLUMN IF NOT EXISTS checklist_checks jsonb,
  ADD COLUMN IF NOT EXISTS adherence_rate numeric,
  ADD COLUMN IF NOT EXISTS execution_grade text,
  ADD COLUMN IF NOT EXISTS behavior_tags text[] DEFAULT '{}';

-- Compliance analytics filters on grade + violations per user; keep it cheap.
CREATE INDEX IF NOT EXISTS trades_user_grade_date_idx
  ON public.trades (user_id, execution_grade, date DESC)
  WHERE deleted_at IS NULL;
