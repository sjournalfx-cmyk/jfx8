import { beforeEach, describe, expect, it } from 'vitest';
import {
  CTRADER_OAUTH_PENDING_KEY,
  clearCtraderOauthPending,
  consumeCtraderOauthCancellation,
  markCtraderOauthPending,
} from '../lib/ctraderOauthReturn';

describe('cTrader OAuth return marker', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('reports a recent cancel/deny exactly once', () => {
    markCtraderOauthPending(1_000);
    expect(consumeCtraderOauthCancellation(2_000, 15 * 60 * 1000)).toBe(true);
    expect(sessionStorage.getItem(CTRADER_OAUTH_PENDING_KEY)).toBeNull();
    expect(consumeCtraderOauthCancellation(2_000, 15 * 60 * 1000)).toBe(false);
  });

  it('ignores markers older than the allowed window', () => {
    markCtraderOauthPending(1_000);
    expect(consumeCtraderOauthCancellation(1_000 + 15 * 60 * 1000 + 1)).toBe(false);
  });

  it('returns false when no authorization was pending', () => {
    expect(consumeCtraderOauthCancellation()).toBe(false);
  });

  it('can be cleared without consuming', () => {
    markCtraderOauthPending(5_000);
    clearCtraderOauthPending();
    expect(sessionStorage.getItem(CTRADER_OAUTH_PENDING_KEY)).toBeNull();
  });
});
