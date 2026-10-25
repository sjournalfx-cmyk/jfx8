import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from '../api/ctrader/callback';
import { createNativeOAuthState } from '../api/_lib/ctraderOAuthState';

function run(query: Record<string, string>) {
  const headers: Record<string, any> = {};
  const res: any = {
    statusCode: 0,
    setHeader: vi.fn((key: string, value: any) => { headers[key] = value; }),
    status: vi.fn((code: number) => { res.statusCode = code; return res; }),
    end: vi.fn(),
  };
  handler({ query } as any, res);
  return { res, headers };
}

describe('cTrader OAuth callback', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('deep-links only a valid server-signed native state', () => {
    vi.stubEnv('CTRADER_OAUTH_STATE_SECRET', 'callback-secret');
    const state = createNativeOAuthState('user-1');
    const { res, headers } = run({ code: 'auth-code', state });

    expect(res.statusCode).toBe(302);
    expect(String(headers.Location)).toMatch(/^site\.jfxjournal\.app:\/\/ctrader\?/);
    expect(String(headers.Location)).toContain(`state=${encodeURIComponent(state)}`);
  });

  it('rejects the legacy fixed jfx-native state', () => {
    vi.stubEnv('CTRADER_OAUTH_STATE_SECRET', 'callback-secret');
    const { res, headers } = run({ code: 'auth-code', state: 'jfx-native' });

    expect(res.statusCode).toBe(302);
    expect(String(headers.Location)).toBe('/?code=auth-code&state=jfx-native');
  });

  it('does not deep-link a tampered signed state', () => {
    vi.stubEnv('CTRADER_OAUTH_STATE_SECRET', 'callback-secret');
    const state = createNativeOAuthState('user-1');
    const { res, headers } = run({ code: 'auth-code', state: `${state}x` });

    expect(res.statusCode).toBe(302);
    expect(String(headers.Location)).not.toContain('site.jfxjournal.app');
  });
});
