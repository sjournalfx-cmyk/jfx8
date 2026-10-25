import { afterEach, describe, expect, it, vi } from 'vitest';
import { persistDefaultCtraderAccount } from './ctraderDefaults';

describe('persistDefaultCtraderAccount', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('PATCHes the signed-in user token row with account and demo flag', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => '' }));
    vi.stubGlobal('fetch', fetchMock);

    await persistDefaultCtraderAccount({
      supabaseUrl: 'https://example.supabase.co/',
      serviceKey: 'service-key',
      userId: 'user-1',
      accountId: 12345,
      isDemo: false,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toBe('https://example.supabase.co/rest/v1/user_ctrader_tokens?user_id=eq.user-1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toMatchObject({
      default_account_id: 12345,
      is_demo: false,
    });
  });

  it('fails loudly when the row cannot be updated', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 503,
      text: async () => 'database unavailable',
    })));

    await expect(persistDefaultCtraderAccount({
      supabaseUrl: 'https://example.supabase.co',
      serviceKey: 'service-key',
      userId: 'user-1',
      accountId: 12345,
      isDemo: true,
    })).rejects.toThrow(/HTTP 503/);
  });

  it('refuses to write without database configuration', async () => {
    await expect(persistDefaultCtraderAccount({
      supabaseUrl: '',
      serviceKey: '',
      userId: 'user-1',
      accountId: 12345,
      isDemo: true,
    })).rejects.toThrow(/configuration/i);
  });
});
