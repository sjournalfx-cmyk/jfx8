-- Trading locks: per-portfolio hard limits (pair whitelist, max trades/day,
-- lot guard) created in Settings → Rules & Checklists and mirrored here so
-- agent/API order paths cannot bypass them. Closes and SL/TP edits are
-- never gated — only new risk (see api/ctrader/trade.ts).
--
-- Apply with: supabase db push (or your existing supabase:migrate flow).
-- All readers fail open when this table is absent, so trading never breaks
-- before the migration lands.

create table if not exists public.portfolio_locks (
  user_id uuid not null references auth.users(id) on delete cascade,
  portfolio_id text not null,
  locks jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, portfolio_id)
);

alter table public.portfolio_locks enable row level security;

drop policy if exists "portfolio_locks_owner_select" on public.portfolio_locks;
create policy "portfolio_locks_owner_select" on public.portfolio_locks
  for select using (auth.uid() = user_id);

drop policy if exists "portfolio_locks_owner_insert" on public.portfolio_locks;
create policy "portfolio_locks_owner_insert" on public.portfolio_locks
  for insert with check (auth.uid() = user_id);

drop policy if exists "portfolio_locks_owner_update" on public.portfolio_locks;
create policy "portfolio_locks_owner_update" on public.portfolio_locks
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "portfolio_locks_owner_delete" on public.portfolio_locks;
create policy "portfolio_locks_owner_delete" on public.portfolio_locks
  for delete using (auth.uid() = user_id);
