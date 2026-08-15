-- Personal API keys for the external JFX Journal API.
-- Raw tokens are generated and returned only by generate_api_key().

create extension if not exists pgcrypto;

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  key_prefix text not null,
  key_hash text not null unique,
  scopes text[] not null default '{}'::text[],
  last_used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint api_keys_valid_scopes check (
    scopes <@ array['trades:read', 'trades:write', 'notes:read', 'notes:write', 'bridge:read', 'me:read']::text[]
  )
);

create index if not exists api_keys_user_id_idx on public.api_keys (user_id);
create index if not exists api_keys_prefix_idx on public.api_keys (key_prefix);

alter table public.api_keys enable row level security;

create policy "Users can delete their own API keys"
  on public.api_keys for delete to authenticated
  using ((select auth.uid()) = user_id);

-- This table is deliberately not user-readable or user-writable. The Edge
-- Function uses the service role and the owner gets metadata through RPC.
create table if not exists public.api_key_rate_limits (
  bucket text not null check (bucket in ('key_minute', 'key_hour', 'user_minute')),
  subject_id uuid not null,
  window_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (bucket, subject_id, window_start)
);
alter table public.api_key_rate_limits enable row level security;

create table if not exists public.api_key_audit (
  id bigint generated always as identity primary key,
  key_id uuid references public.api_keys(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  method text not null,
  path text not null,
  status smallint not null,
  duration_ms integer,
  ip inet,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists api_key_audit_user_created_idx
  on public.api_key_audit (user_id, created_at desc);
alter table public.api_key_audit enable row level security;

-- SECURITY DEFINER is required because api_keys deliberately has no SELECT or
-- INSERT policy. Search path is fixed and every callable function verifies the
-- authenticated caller before accessing data.
create or replace function public.generate_api_key(
  p_name text,
  p_scopes text[],
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_secret text;
  v_raw text;
  v_prefix text;
  v_hash text;
  v_allowed_scopes constant text[] := array['trades:read', 'trades:write', 'notes:read', 'notes:write', 'bridge:read', 'me:read'];
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 80 then
    raise exception 'Key name must be between 1 and 80 characters';
  end if;
  if coalesce(p_scopes, '{}'::text[]) = '{}'::text[] or not (p_scopes <@ v_allowed_scopes) then
    raise exception 'At least one valid scope is required';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'Expiry must be in the future';
  end if;

  -- 32 base62 characters. 32 random bytes are more than sufficient entropy;
  -- characters outside base62 are deterministically mapped to a safe alphabet.
  v_secret := substr(translate(encode(gen_random_bytes(32), 'base64'), '+/', 'AZ'), 1, 32);
  v_prefix := 'jfx_pat_' || substr(replace(v_user::text, '-', ''), 1, 8);
  v_raw := v_prefix || '_' || v_secret;
  v_hash := encode(digest(v_raw, 'sha256'), 'hex');

  insert into public.api_keys (user_id, name, key_prefix, key_hash, scopes, expires_at)
  values (v_user, trim(p_name), v_prefix, v_hash, array(select distinct unnest(p_scopes)), p_expires_at);

  return jsonb_build_object('raw_key', v_raw, 'prefix', v_prefix);
end;
$$;

create or replace function public.list_api_keys()
returns table (
  id uuid, name text, key_prefix text, scopes text[], last_used_at timestamptz,
  expires_at timestamptz, created_at timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select k.id, k.name, k.key_prefix, k.scopes, k.last_used_at, k.expires_at, k.created_at
  from public.api_keys k
  where k.user_id = auth.uid()
  order by k.created_at desc;
$$;

-- Atomically consumes all three limits. Called only by the Edge Function's
-- service-role client; no browser role receives execute rights.
create or replace function public.consume_api_key_rate_limit(p_user_id uuid, p_key_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_minute timestamptz := date_trunc('minute', now());
  v_hour timestamptz := date_trunc('hour', now());
  v_key_minute integer;
  v_key_hour integer;
  v_user_minute integer;
begin
  insert into public.api_key_rate_limits as r (bucket, subject_id, window_start, request_count)
  values ('key_minute', p_key_id, v_minute, 1)
  on conflict (bucket, subject_id, window_start)
  do update set request_count = r.request_count + 1
  returning request_count into v_key_minute;

  insert into public.api_key_rate_limits as r (bucket, subject_id, window_start, request_count)
  values ('key_hour', p_key_id, v_hour, 1)
  on conflict (bucket, subject_id, window_start)
  do update set request_count = r.request_count + 1
  returning request_count into v_key_hour;

  insert into public.api_key_rate_limits as r (bucket, subject_id, window_start, request_count)
  values ('user_minute', p_user_id, v_minute, 1)
  on conflict (bucket, subject_id, window_start)
  do update set request_count = r.request_count + 1
  returning request_count into v_user_minute;

  return v_key_minute <= 60 and v_key_hour <= 1000 and v_user_minute <= 200;
end;
$$;

revoke all on public.api_keys, public.api_key_rate_limits, public.api_key_audit from anon, authenticated;
revoke all on function public.generate_api_key(text, text[], timestamptz) from public, anon;
revoke all on function public.list_api_keys() from public, anon;
revoke all on function public.consume_api_key_rate_limit(uuid, uuid) from public, anon, authenticated;
grant execute on function public.generate_api_key(text, text[], timestamptz) to authenticated;
grant execute on function public.list_api_keys() to authenticated;
grant delete on public.api_keys to authenticated;
