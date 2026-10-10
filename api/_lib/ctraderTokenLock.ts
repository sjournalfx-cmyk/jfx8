/**
 * cTrader refresh tokens are single-use. This short service-only database
 * lease serializes rotations across tabs and serverless instances.
 */
export async function setCtraderRefreshLease(
  supabaseUrl: string,
  serviceKey: string,
  userId: string,
  acquire: boolean,
): Promise<boolean> {
  const rpc = acquire
    ? 'try_acquire_ctrader_token_refresh_lock'
    : 'release_ctrader_token_refresh_lock';
  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/${rpc}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify(acquire
      ? { p_user_id: userId, p_lease_seconds: 30 }
      : { p_user_id: userId }),
  });
  if (!response.ok) throw new Error('ctrader_refresh_lock_unavailable');
  return acquire ? await response.json().catch(() => false) === true : true;
}
