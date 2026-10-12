-- Agent order idempotency: one row per Idempotency-Key so retried
-- POST /api/ctrader/trade opens replay the stored result instead of
-- opening a second position (see api/ctrader/trade.ts).
--
-- Looked up by exact key; same key + different order params is rejected
-- with 409 idempotency_conflict. Rows expire after 7 days via
-- created_at (a scheduled cleanup may delete them; readers fail open
-- when this table is absent, so trading never breaks pre-migration).
--
-- Apply with: supabase db push (or your existing supabase:migrate flow).

create table if not exists public.api_order_idempotency (
  key text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  key_id uuid null,
  account_id bigint not null,
  params_hash text not null,
  status text not null default 'completed',
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (key)
);

alter table public.api_order_idempotency enable row level security;

drop policy if exists "api_order_idempotency_owner_select" on public.api_order_idempotency;
create policy "api_order_idempotency_owner_select" on public.api_order_idempotency
  for select using (auth.uid() = user_id);

drop policy if exists "api_order_idempotency_owner_insert" on public.api_order_idempotency;
create policy "api_order_idempotency_owner_insert" on public.api_order_idempotency
  for insert with check (auth.uid() = user_id);

drop policy if exists "api_order_idempotency_owner_update" on public.api_order_idempotency;
create policy "api_order_idempotency_owner_update" on public.api_order_idempotency
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "api_order_idempotency_owner_delete" on public.api_order_idempotency;
create policy "api_order_idempotency_owner_delete" on public.api_order_idempotency
  for delete using (auth.uid() = user_id);

create index if not exists api_order_idempotency_user_created_idx
  on public.api_order_idempotency (user_id, created_at desc);
