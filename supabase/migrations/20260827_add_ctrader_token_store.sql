-- ============================================================================
-- user_ctrader_tokens — secure server-side storage for cTrader OAuth tokens
--
-- End users and external AI agents NEVER see these tokens. The service_role
-- reads and rotates them when executing trades on behalf of the user.
-- No RLS select policy is granted to authenticated users intentionally.
-- ============================================================================

create table if not exists public.user_ctrader_tokens (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  refresh_token       text not null,
  account_ids         bigint[] not null default '{}',
  default_account_id  bigint,
  is_demo             boolean not null default true,
  updated_at          timestamptz not null default now()
);

alter table public.user_ctrader_tokens enable row level security;

comment on table public.user_ctrader_tokens is
  'Server-side storage for cTrader OAuth refresh tokens. Accessible only by service_role. Never exposed to browser clients or AI agents.';

comment on column public.user_ctrader_tokens.refresh_token is
  'Long-lived cTrader OAuth refresh token. Used by the server to mint access tokens for trade execution. Never returned in API responses.';
