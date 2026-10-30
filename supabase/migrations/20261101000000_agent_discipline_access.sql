-- Agent access expansion: economic calendar, broker balance/equity, strategy
-- rules & checklists, and trading-locks management via JFX personal API keys.
--
-- 1. New scopes opt-in at key creation time (nothing is granted implicitly —
--    trades:write does NOT imply any of these).
-- 2. discipline_settings is the single-row-per-user cloud mirror of the
--    checklist templates that previously lived only in localStorage
--    (jfx_checklist_templates). The document model matches how the app saves
--    the whole templates array on every mutation.

create table if not exists public.discipline_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  checklist_templates jsonb not null default '[]'::jsonb,
  active_checklist_template_id text,
  updated_at timestamptz not null default now()
);

alter table public.discipline_settings enable row level security;

drop policy if exists "discipline_settings_owner_select" on public.discipline_settings;
create policy "discipline_settings_owner_select" on public.discipline_settings
  for select using ((select auth.uid()) = user_id);

drop policy if exists "discipline_settings_owner_insert" on public.discipline_settings;
create policy "discipline_settings_owner_insert" on public.discipline_settings
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists "discipline_settings_owner_update" on public.discipline_settings;
create policy "discipline_settings_owner_update" on public.discipline_settings
  for update using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "discipline_settings_owner_delete" on public.discipline_settings;
create policy "discipline_settings_owner_delete" on public.discipline_settings
  for delete using ((select auth.uid()) = user_id);

-- Widen the allowed-scope CHECK to the new agent scopes.
alter table public.api_keys drop constraint if exists api_keys_valid_scopes;

alter table public.api_keys add constraint api_keys_valid_scopes check (
  scopes <@ array[
    'trades:read', 'trades:write',
    'notes:read', 'notes:write',
    'bridge:read',
    'me:read',
    'account:read',
    'calendar:read',
    'checklists:read', 'checklists:write',
    'locks:read', 'locks:write'
  ]::text[]
);

-- generate_api_key must accept the new scopes too (old allowed-list constant).
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
  v_allowed_scopes constant text[] := array[
    'trades:read', 'trades:write',
    'notes:read', 'notes:write',
    'bridge:read',
    'me:read',
    'account:read',
    'calendar:read',
    'checklists:read', 'checklists:write',
    'locks:read', 'locks:write'
  ];
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
  v_prefix := 'jfx_pat_' || substr(encode(gen_random_bytes(6), 'hex'), 1, 8);
  v_raw := v_prefix || '_' || v_secret;
  v_hash := encode(digest(v_raw, 'sha256'), 'hex');

  insert into public.api_keys (user_id, name, key_prefix, key_hash, scopes, expires_at)
  values (v_user, trim(p_name), v_prefix, v_hash, array(select distinct unnest(p_scopes)), p_expires_at);

  return jsonb_build_object('raw_key', v_raw, 'prefix', v_prefix);
end;
$$;
