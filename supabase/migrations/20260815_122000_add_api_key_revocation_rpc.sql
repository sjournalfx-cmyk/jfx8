-- Browser roles must not access the protected api_keys table directly.
-- This function verifies ownership from the caller's JWT, then performs the
-- delete so the existing revocation-history trigger can record safe metadata.
create or replace function public.revoke_api_key(p_key_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;

  delete from public.api_keys
  where id = p_key_id
    and user_id = v_user;

  return found;
end;
$$;

revoke all on function public.revoke_api_key(uuid) from public, anon;
grant execute on function public.revoke_api_key(uuid) to authenticated;
