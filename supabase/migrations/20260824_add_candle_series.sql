-- Migration: Shared candle series store for the Backtest Lab.
-- The server-side harvester (service cTrader account) writes; every user reads.
create table if not exists public.candle_series (
  symbol        text not null,
  timeframe     text not null,
  bars          jsonb not null default '[]'::jsonb,
  bar_count     int  not null default 0,
  last_bar_time bigint not null default 0,   -- unix seconds of newest bar
  digits        int  not null default 5,
  updated_at    timestamptz not null default now(),
  primary key (symbol, timeframe)
);

alter table public.candle_series enable row level security;

drop policy if exists "public read candle_series" on public.candle_series;
create policy "public read candle_series"
  on public.candle_series for select
  to anon, authenticated
  using (true);
-- No insert/update policies: only the service_role key (server-side) may write.

create index if not exists candle_series_updated_idx on public.candle_series (updated_at desc);

-- Harvest work queue: the cron endpoint claims a bounded batch per tick so a
-- full backfill of every symbol x timeframe completes across many short runs
-- (Vercel functions have hard execution-time limits).
create table if not exists public.harvest_queue (
  id         bigserial primary key,
  symbol     text not null,
  symbol_id  int  not null,
  digits     int  not null default 5,
  timeframe  text not null,
  status     text not null default 'pending', -- pending | done | error
  attempts   int  not null default 0,
  updated_at timestamptz not null default now(),
  unique (symbol_id, timeframe)
);

create index if not exists harvest_queue_status_idx on public.harvest_queue (status, id);

-- Service session storage: cTrader rotates the refresh token on every mint,
-- so the harvester persists the latest one here (service_role writes; RLS
-- blocks all client access).
create table if not exists public.service_config (
  key   text primary key,
  value text not null
);
alter table public.service_config enable row level security;
