import { describe, expect, it } from 'vitest';
import {
  blankPortfolioLocks,
  dayBoundsInTz,
  dayKeyInTz,
  editLotGuard,
  editMaxTrades,
  editPairWhitelist,
  evaluateLocks,
  formatUnlockCountdown,
  isRuleActive,
  LOCK_UNLOCK_COOLDOWN_MS,
  normalizePortfolioLocks,
  pairCountLabel,
  pendingChangeElapsed,
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

describe('tighten now / loosen later', () => {
  it('applies a lower max immediately and defers a raise for 24h', () => {
    const now = Date.parse('2026-01-01T10:00:00Z');
    const rule = { enabled: true, maxPerDay: 5, unlockRequestedAt: null, pendingChange: null };

    const tightened = editMaxTrades(rule, 3, now);
    expect(tightened.maxPerDay).toBe(3);
    expect(tightened.pendingChange).toBeNull();

    const loosened = editMaxTrades(tightened, 8, now);
    expect(loosened.maxPerDay).toBe(3);
    expect(loosened.pendingChange?.value.maxPerDay).toBe(8);
    expect(loosened.pendingChange?.requestedAt).toBe(new Date(now).toISOString());

    const locks = { ...blankPortfolioLocks(), maxTrades: loosened };
    expect(evaluateLocks(locks, { symbolId: null, volumeLots: 0.01, fillsToday: 3, now: now + 1000 }).allowed).toBe(false);
  });

  it('merges an elapsed pending change and clears it', () => {
    const now = Date.parse('2026-01-02T10:00:00Z');
    const locks = blankPortfolioLocks();
    locks.maxTrades = {
      enabled: true,
      maxPerDay: 3,
      unlockRequestedAt: null,
      pendingChange: {
        value: { maxPerDay: 8 },
        requestedAt: new Date(now - LOCK_UNLOCK_COOLDOWN_MS - 1000).toISOString(),
      },
    };

    const normalized = normalizePortfolioLocks(locks, now);
    expect(normalized.maxTrades.maxPerDay).toBe(8);
    expect(normalized.maxTrades.pendingChange).toBeNull();
    expect(evaluateLocks(locks, { symbolId: null, volumeLots: 0.01, fillsToday: 5, now }).allowed).toBe(true);
  });

  it('ignores pending timestamps in the future', () => {
    const now = Date.parse('2026-01-02T10:00:00Z');
    const locks = blankPortfolioLocks();
    locks.maxTrades = {
      enabled: true,
      maxPerDay: 3,
      unlockRequestedAt: null,
      pendingChange: { value: { maxPerDay: 8 }, requestedAt: new Date(now + 60_000).toISOString() },
    };

    expect(pendingChangeElapsed(locks.maxTrades.pendingChange, now)).toBe(false);
    const normalized = normalizePortfolioLocks(locks, now);
    expect(normalized.maxTrades.maxPerDay).toBe(3);
    expect(normalized.maxTrades.pendingChange).not.toBeNull();
    expect(evaluateLocks(locks, { symbolId: null, volumeLots: 0.01, fillsToday: 5, now }).allowed).toBe(false);
  });

  it('updates a pending raise without losing it or resetting a shorter wait', () => {
    const now = Date.parse('2026-01-02T10:00:00Z');
    const requestedAt = new Date(now - 60_000).toISOString();
    const rule = {
      enabled: true,
      maxPerDay: 3,
      unlockRequestedAt: null,
      pendingChange: { value: { maxPerDay: 8 }, requestedAt },
    };

    const smallerRaise = editMaxTrades(rule, 5, now);
    expect(smallerRaise.maxPerDay).toBe(3);
    expect(smallerRaise.pendingChange?.value.maxPerDay).toBe(5);
    expect(smallerRaise.pendingChange?.requestedAt).toBe(requestedAt);

    const biggerRaise = editMaxTrades(smallerRaise, 9, now + 1000);
    expect(biggerRaise.pendingChange?.value.maxPerDay).toBe(9);
    expect(biggerRaise.pendingChange?.requestedAt).toBe(new Date(now + 1000).toISOString());
  });

  it('keeps a pending lot loosening when the other bound is tightened', () => {
    const now = Date.parse('2026-01-02T10:00:00Z');
    const requestedAt = new Date(now - 60_000).toISOString();
    const rule = {
      enabled: true,
      minLots: 0.1,
      maxLots: 1,
      unlockRequestedAt: null,
      pendingChange: { value: { minLots: 0.05 }, requestedAt },
    };

    const tightenedMax = editLotGuard(rule, { maxLots: 0.5 }, now);
    expect(tightenedMax.maxLots).toBe(0.5);
    expect(tightenedMax.minLots).toBe(0.1);
    expect(tightenedMax.pendingChange?.value.minLots).toBe(0.05);
    expect(tightenedMax.pendingChange?.requestedAt).toBe(requestedAt);

    const loosenedMax = editLotGuard(rule, { maxLots: 2 }, now);
    expect(loosenedMax.maxLots).toBe(1);
    expect(loosenedMax.pendingChange?.value.maxLots).toBe(2);
  });

  it('removes pairs now but never removes the last current pair', () => {
    const now = Date.parse('2026-01-02T10:00:00Z');
    const rule = {
      enabled: true,
      symbolIds: [1],
      symbolNames: { 1: 'EURUSD' },
      unlockRequestedAt: null,
      pendingChange: null,
    };

    expect(editPairWhitelist(rule, { symbolIds: [] }, now).symbolIds).toEqual([1]);

    const added = editPairWhitelist(rule, { symbolIds: [1, 2], symbolNames: { 1: 'EURUSD', 2: 'GBPUSD' } }, now);
    expect(added.symbolIds).toEqual([1]);
    expect(added.pendingChange?.value.symbolIds).toEqual([1, 2]);
  });
});

describe('invalid / unknown inputs', () => {
  it('blocks an invalid stored lot range as a misconfiguration', () => {
    const locks = blankPortfolioLocks();
    locks.lotGuard = { enabled: true, minLots: 1, maxLots: 0.5, unlockRequestedAt: null };
    const blocked = evaluateLocks(locks, { symbolId: null, volumeLots: 0.75, fillsToday: 0 });
    expect(blocked.allowed).toBe(false);
    if (blocked.allowed === false) {
      expect(blocked.rule).toBe('lotGuard');
      expect(blocked.message).toBe('Lot limits are invalid (min above max). Fix them in Trading Locks.');
    }
  });

  it('blocks unknown fills only while maxTrades is active', () => {
    const locks = blankPortfolioLocks();
    locks.maxTrades = { enabled: true, maxPerDay: 2, unlockRequestedAt: null };
    const blocked = evaluateLocks(locks, { symbolId: null, volumeLots: 0.01, fillsToday: null });
    expect(blocked.allowed).toBe(false);
    if (blocked.allowed === false) {
      expect(blocked.rule).toBe('maxTrades');
      expect(blocked.reason).toBe('count_unavailable');
      expect(blocked.message).toBe("Couldn't confirm today's trade count. Try again in a moment.");
    }
    expect(evaluateLocks(blankPortfolioLocks(), { symbolId: null, volumeLots: 0.01, fillsToday: null }).allowed).toBe(true);
  });

  it('names the timezone in the daily-reset message', () => {
    const locks = blankPortfolioLocks();
    locks.maxTrades = { enabled: true, maxPerDay: 2, unlockRequestedAt: null };
    const blocked = evaluateLocks(locks, {
      symbolId: null,
      volumeLots: 0.01,
      fillsToday: 2,
      timezone: 'Africa/Johannesburg',
    });
    expect(blocked.allowed).toBe(false);
    if (blocked.allowed === false) expect(blocked.message).toContain('resets 00:00 SAST');
  });
});

describe('copy helpers', () => {
  it('pluralizes pair counts', () => {
    expect(pairCountLabel(0)).toBe('0 pairs');
    expect(pairCountLabel(1)).toBe('1 pair');
    expect(pairCountLabel(2)).toBe('2 pairs');
  });

  it('computes local-day bounds in a timezone', () => {
    const ts = Date.parse('2026-01-01T22:30:00Z');
    const { start, end } = dayBoundsInTz(ts, 'Africa/Johannesburg');
    expect(start).toBe(Date.parse('2026-01-01T22:00:00Z'));
    expect(end).toBe(Date.parse('2026-01-02T22:00:00Z'));
  });
});

describe('dayKeyInTz', () => {
  it('keys days in the given timezone', () => {
    // 2026-01-01T22:30:00Z is 2026-01-02 00:30 in Johannesburg (UTC+2).
    expect(dayKeyInTz(Date.parse('2026-01-01T22:30:00Z'), 'Africa/Johannesburg')).toBe('2026-01-02');
    expect(dayKeyInTz(Date.parse('2026-01-01T22:30:00Z'), 'UTC')).toBe('2026-01-01');
  });
});
