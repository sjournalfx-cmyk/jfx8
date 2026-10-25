/**
 * Persist the cTrader account a user last selected (or linked to a portfolio)
 * so API-key orders and candles do not fall back to "first demo account".
 *
 * The token row already exists after a successful OAuth exchange; this is a
 * PATCH only. A missing row is not an error (nothing has been connected yet).
 */

export async function persistDefaultCtraderAccount(args: {
  supabaseUrl: string;
  serviceKey: string;
  userId: string;
  accountId: number;
  isDemo: boolean;
}): Promise<void> {
  const { supabaseUrl, serviceKey, userId, accountId, isDemo } = args;
  const base = (supabaseUrl || '').trim().replace(/\/$/, '');
  const key = (serviceKey || '').trim();
  if (!base || !key || !userId || !Number.isFinite(Number(accountId)) || Number(accountId) <= 0) {
    throw new Error('Cannot persist cTrader default account: database configuration or account id is missing.');
  }

  const response = await fetch(
    `${base}/rest/v1/user_ctrader_tokens?user_id=eq.${encodeURIComponent(userId)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        default_account_id: Number(accountId),
        is_demo: Boolean(isDemo),
        updated_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(10000),
    },
  );

  if (!response.ok) {
    let detail = '';
    try { detail = (await response.text()).slice(0, 300); } catch { /* ignore */ }
    throw new Error(`Failed to persist cTrader default account (HTTP ${response.status}${detail ? `: ${detail}` : ''}).`);
  }
}
