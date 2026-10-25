import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./auth.js', () => ({
  requireUser: vi.fn(async () => ({ ok: true, userId: 'user-1' })),
}));

import handler from './logoutHandler';

function mockRes() {
  const headers: Record<string, any> = {};
  const res: any = {
    statusCode: 0,
    body: null,
    setHeader: vi.fn((key: string, value: any) => { headers[key] = value; }),
    status: vi.fn((code: number) => { res.statusCode = code; return res; }),
    json: vi.fn((body: any) => { res.body = body; return res; }),
    end: vi.fn(),
  };
  return { res, headers };
}

describe('cTrader logout handler', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('revokes both the token row and the legacy service_config key', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co/');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
    const fetchMock = vi.fn(async () => ({ ok: true, status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const { res, headers } = mockRes();

    await handler({ method: 'POST', headers: { authorization: 'Bearer user-jwt' } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(String(headers['Set-Cookie'])).toMatch(/Max-Age=0/);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const urls = fetchMock.mock.calls.map((call: any[]) => call[0]);
    expect(urls).toContain('https://example.supabase.co/rest/v1/user_ctrader_tokens?user_id=eq.user-1');
    expect(urls).toContain('https://example.supabase.co/rest/v1/service_config?key=eq.ctrader_refresh_user-1');
    for (const call of fetchMock.mock.calls as any[][]) {
      expect(call[1].method).toBe('DELETE');
    }
  });

  it('still expires the cookie when the database is not configured', async () => {
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { res, headers } = mockRes();

    await handler({ method: 'POST', headers: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(headers['Set-Cookie'])).toMatch(/Max-Age=0/);
  });
});
