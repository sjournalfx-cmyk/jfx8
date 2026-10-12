import { describe, expect, it } from 'vitest';
import {
  blankPortfolioLocks,
  dayKeyInTz,
  evaluateLocks,
  formatUnlockCountdown,
  isRuleActive,
  LOCK_UNLOCK_COOLDOWN_MS,
  unlockMsRemaining,
} from './tradingLocks';

describe('unlock cooling', () => {
  it('inactive when disabled, active when enabled with no request', () => {
    expect(isRuleActive({ enabled: false, unlockRequestedAt: null })).toBe(false);
    expect(isRuleActive({ enabled: true, unlockRequestedAt: null })).toBe(true);
  });

  it('rule STAYS binding during cooling, drops only after 24h', () => {
    const now = Date.now();
    const requested = new Date(now - 60 * 60 * 1000).toISOString();
    // 1h into cooling: still enforced.
    expect(isRuleActive({ enabled: true, unlockRequestedAt: requested }, now)).toBe(true);
    expect(unlockMsRemaining(requested, now)).toBeGreaterThan(0);
    // Past expiry: off.
    const expired = new Date(now - LOCK_UNLOCK_COOLDOWN_MS - 1000).toISOString();
    expect(isRuleActive({ enabled: true, unlockRequestedAt: expired }, now)).toBe(false);
  });

  it('formats countdown as HH:MM:SS', () => {
    const now = Date.now();
    const requested = new Date(now - 10 * 60 * 60 * 1000).toISOString();
    expect(formatUnlockCountdown(requested, now)).toMatch(/^14:00:00$/);
  });
});

describe('evaluateLocks', () => {
  it('allows everything when all rules disabled', () => {
    expect(evaluateLocks(blankPortfolioLocks(), { symbolId: 1, volumeLots: 5, fillsToday: 99 })).toEqual({ allowed: true });
  });

  it('blocks non-whitelisted pairs', () => {
    const locks = blankPortfolioLocks();
    locks.pairWhitelist = { enabled: true, symbolIds: [11, 22], symbolNames: {}, unlockRequestedAt: null };
    expect(evaluateLocks(locks, { symbolId: 11, volumeLots: 0.01, fillsToday: 0 }).allowed).toBe(true);
    const blocked = evaluateLocks(locks, { symbolId: 99, volumeLots: 0.01, fillsToday: 0 });
    expect(blocked.allowed).toBe(false);
    if (blocked.allowed === false) expect(blocked.rule).toBe('pairWhitelist');
  });

  it('blocks beyond the daily max', () => {
    const locks = blankPortfolioLocks();
    locks.maxTrades = { enabled: true, maxPerDay: 2, unlockRequestedAt: null };
    expect(evaluateLocks(locks, { symbolId: null, volumeLots: 0.01, fillsToday: 1 }).allowed).toBe(true);
    const blocked = evaluateLocks(locks, { symbolId: null, volumeLots: 0.01, fillsToday: 2 });
    expect(blocked.allowed).toBe(false);
    if (blocked.allowed === false) expect(blocked.rule).toBe('maxTrades');
  });

  it('blocks out-of-range lots', () => {
    const locks = blankPortfolioLocks();
    locks.lotGuard = { enabled: true, minLots: 0.01, maxLots: 0.5, unlockRequestedAt: null };
    expect(evaluateLocks(locks, { symbolId: null, volumeLots: 0.1, fillsToday: 0 }).allowed).toBe(true);
    const blocked = evaluateLocks(locks, { symbolId: null, volumeLots: 1, fillsToday: 0 });
    expect(blocked.allowed).toBe(false);
    if (blocked.allowed === false) expect(blocked.rule).toBe('lotGuard');
  });

  it('cooling unlock keeps enforcing until expiry', () => {
    const locks = blankPortfolioLocks();
    locks.maxTrades = { enabled: true, maxPerDay: 1, unlockRequestedAt: new Date().toISOString() };
    // Still blocked mid-cooling…
    expect(evaluateLocks(locks, { symbolId: null, volumeLots: 0.01, fillsToday: 5 }).allowed).toBe(false);
    // …but allowed once the countdown elapsed.
    locks.maxTrades = { enabled: true, maxPerDay: 1, unlockRequestedAt: new Date(Date.now() - LOCK_UNLOCK_COOLDOWN_MS - 1000).toISOString() };
    expect(evaluateLocks(locks, { symbolId: null, volumeLots: 0.01, fillsToday: 5 }).allowed).toBe(true);
  });
});

describe('dayKeyInTz', () => {
  it('keys days in the given timezone', () => {
    // 2026-01-01T22:30:00Z is 2026-01-02 00:30 in Johannesburg (UTC+2).
    expect(dayKeyInTz(Date.parse('2026-01-01T22:30:00Z'), 'Africa/Johannesburg')).toBe('2026-01-02');
    expect(dayKeyInTz(Date.parse('2026-01-01T22:30:00Z'), 'UTC')).toBe('2026-01-01');
  });
});
