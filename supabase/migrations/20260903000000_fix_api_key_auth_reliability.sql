-- Fix API-key reliability issues found in the agent-harness auth audit.
--
-- 1. Random key_prefix for new keys. The old generate_api_key() derived the
--    prefix from the user id, so every key for one user shared the same
--    prefix and was indistinguishable in the UI (users pasted/revoked the
--    wrong key -> 401 invalid_api_key). Old keys keep working; only new keys
--    get a random suffix. Format stays jfx_pat_<8hex>_<32> (no breaking change).
-- 2. Explicit service_role grants so Vercel/Edge service clients can always
--    execute the RPCs even after the public/anon/authenticated revokes.
-- 3. Idempotent list_api_keys() with the 9-column (status/revoked_at) shape so
--    environments that only ran the first migration still return what the UI
--    expects.

create extension if not exists pgcrypto;

-- 1. Random prefix for new keys (keep validator ^jfx_pat_[a-z0-9]{8}_[A-Za-z0-9]{32}$)
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

  v_secret := substr(translate(encode(gen_random_bytes(32), 'base64'), '+/', 'AZ'), 1, 32);
  -- 8 random lowercase hex chars: unique per key, still matches [a-z0-9]{8}.
  v_prefix := 'jfx_pat_' || substr(encode(gen_random_bytes(6), 'hex'), 1, 8);
  v_raw := v_prefix || '_' || v_secret;
  v_hash := encode(digest(v_raw, 'sha256'), 'hex');

  insert into public.api_keys (user_id, name, key_prefix, key_hash, scopes, expires_at)
  values (v_user, trim(p_name), v_prefix, v_hash, array(select distinct unnest(p_scopes)), p_expires_at);

  return jsonb_build_object('raw_key', v_raw, 'prefix', v_prefix);
end;
$$;

-- 2. Service-role can always execute (browser roles unchanged).
grant execute on function public.generate_api_key(text, text[], timestamptz) to service_role;
grant execute on function public.consume_api_key_rate_limit(uuid, uuid) to service_role;
grant execute on function public.revoke_api_key(uuid) to service_role;

-- 3. Canonical list_api_keys() shape (active + revoked union).
create or replace function public.list_api_keys()
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

revoke all on function public.list_api_keys() from public, anon;
grant execute on function public.list_api_keys() to authenticated, service_role;
