-- Keep non-secret metadata after a key is deleted so the owner can see that it
-- was revoked. The live api_keys row is still removed immediately, which is
-- the authoritative revocation mechanism.
create table if not exists public.api_key_revocations (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  key_prefix text not null,
  scopes text[] not null,
  created_at timestamptz not null,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz not null default now()
);
create index if not exists api_key_revocations_user_id_idx on public.api_key_revocations (user_id, revoked_at desc);
alter table public.api_key_revocations enable row level security;

create or replace function public.record_api_key_revocation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.api_key_revocations (id, user_id, name, key_prefix, scopes, created_at, last_used_at, expires_at)
  values (old.id, old.user_id, old.name, old.key_prefix, old.scopes, old.created_at, old.last_used_at, old.expires_at)
  on conflict (id) do nothing;
  return old;
end;
$$;

drop trigger if exists api_key_revocation_history on public.api_keys;
create trigger api_key_revocation_history
  before delete on public.api_keys
  for each row execute function public.record_api_key_revocation();

drop function if exists public.list_api_keys();
create function public.list_api_keys()
returns table (
  id uuid, name text, key_prefix text, scopes text[], last_used_at timestamptz,
  expires_at timestamptz, created_at timestamptz, status text, revoked_at timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select k.id, k.name, k.key_prefix, k.scopes, k.last_used_at, k.expires_at, k.created_at, 'active'::text, null::timestamptz
  from public.api_keys k where k.user_id = auth.uid()
  union all
  select r.id, r.name, r.key_prefix, r.scopes, r.last_used_at, r.expires_at, r.created_at, 'revoked'::text, r.revoked_at
  from public.api_key_revocations r where r.user_id = auth.uid()
  order by created_at desc;
$$;

revoke all on public.api_key_revocations from anon, authenticated;
revoke all on function public.record_api_key_revocation() from public, anon, authenticated;
revoke all on function public.list_api_keys() from public, anon;
grant execute on function public.list_api_keys() to authenticated;
