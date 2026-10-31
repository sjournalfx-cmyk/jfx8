-- agent_trade_marks — provenance rows written by the API bridge (service role)
-- whenever an agent/LLM opens, closes, or bulk-closes a broker position through
-- /api/ctrader/trade (or journals directly via POST /v1/trades, which tags the
-- row at the source). The app's cTrader deal-import reads the user's recent
-- marks (RLS: select own) and tags matching journal rows with the 'Agent' tag
-- so the trade journal can render the agent robot badge.

create table if not exists public.agent_trade_marks (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    action text not null check (action in ('open', 'close', 'close_all')),
    position_id text,
    order_id text,
    deal_id text,
    symbol text,
    volume_cents bigint,
    created_at timestamptz not null default now()
);

create index if not exists agent_trade_marks_user_created_idx
    on public.agent_trade_marks (user_id, created_at desc);
create index if not exists agent_trade_marks_position_idx
    on public.agent_trade_marks (user_id, position_id);
create index if not exists agent_trade_marks_order_idx
    on public.agent_trade_marks (user_id, order_id);

alter table public.agent_trade_marks enable row level security;

drop policy if exists "Users can view own agent marks" on public.agent_trade_marks;
create policy "Users can view own agent marks" on public.agent_trade_marks
    for select
    using (auth.uid() = user_id);

-- Writes are service-role only (the API bridge stamps them with the service key).
revoke all on public.agent_trade_marks from anon;
grant select on public.agent_trade_marks to authenticated;
