-- Multi-portfolio definitions, server-side.
-- Until now portfolios lived ONLY on-device (localStorage/Preferences), so an
-- APK uninstall wiped every custom portfolio (e.g. cTrader-linked ones) while
-- the trades themselves survived in Supabase. This table makes portfolios
-- durable across reinstalls and devices.
--
-- Design notes:
-- * ids are client-generated UUIDs (crypto.randomUUID) and are inserted
--   explicitly, so trades.portfolio_id values stay valid across
--   uninstall/reinstall with zero trade-row remapping.
-- * trades.portfolio_id intentionally has NO foreign key: legacy rows carry
--   local-only ids and offline-created portfolios flush later.

CREATE TABLE IF NOT EXISTS public.portfolios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  purpose text,
  source text NOT NULL DEFAULT 'manual',
  starting_balance numeric,
  currency text,
  is_default boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  accounts jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.portfolios ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'portfolios' AND policyname = 'Users can manage their own portfolios'
  ) THEN
    CREATE POLICY "Users can manage their own portfolios"
      ON public.portfolios FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END
$$;

-- One live default per user.
CREATE UNIQUE INDEX IF NOT EXISTS portfolios_user_default_unique
  ON public.portfolios (user_id)
  WHERE is_default AND NOT is_archived;

CREATE INDEX IF NOT EXISTS portfolios_user_created_idx
  ON public.portfolios (user_id, created_at);

-- Keep updated_at fresh (same trigger function as trades/notes).
DROP TRIGGER IF EXISTS handle_updated_at_portfolios ON public.portfolios;
CREATE TRIGGER handle_updated_at_portfolios
  BEFORE UPDATE ON public.portfolios
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
