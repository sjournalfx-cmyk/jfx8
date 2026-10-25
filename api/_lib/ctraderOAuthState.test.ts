import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createNativeOAuthState,
  isNativeOAuthState,
  verifyNativeOAuthState,
} from './ctraderOAuthState';

describe('native cTrader OAuth state', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('round-trips a user-bound state', () => {
    vi.stubEnv('CTRADER_OAUTH_STATE_SECRET', 'test-state-secret');
    const now = Date.parse('2026-01-02T10:00:00Z');
    const state = createNativeOAuthState('user-1', 600_000, now);

    expect(isNativeOAuthState(state)).toBe(true);
    const payload = verifyNativeOAuthState(state, 'user-1', now + 1000);
    expect(payload).toMatchObject({ v: 1, uid: 'user-1', n: 1 });
  });

  it('rejects tampering, another user, expiry, and the legacy fixed value', () => {
    vi.stubEnv('CTRADER_OAUTH_STATE_SECRET', 'test-state-secret');
    const now = Date.parse('2026-01-02T10:00:00Z');
    const state = createNativeOAuthState('user-1', 60_000, now);

    expect(verifyNativeOAuthState(`${state}x`, 'user-1', now)).toBeNull();
    expect(verifyNativeOAuthState(state, 'user-2', now)).toBeNull();
    expect(verifyNativeOAuthState(state, 'user-1', now + 61_000)).toBeNull();
    expect(verifyNativeOAuthState('jfx-native', 'user-1', now)).toBeNull();
  });

  it('uses two different secrets so a state from another deployment is invalid', () => {
    vi.stubEnv('CTRADER_OAUTH_STATE_SECRET', 'secret-a');
    const state = createNativeOAuthState('user-1');
    vi.stubEnv('CTRADER_OAUTH_STATE_SECRET', 'secret-b');
    expect(verifyNativeOAuthState(state, 'user-1')).toBeNull();
  });
});
