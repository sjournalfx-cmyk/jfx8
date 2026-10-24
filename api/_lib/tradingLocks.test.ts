import { describe, expect, it } from 'vitest';
import {
  evaluateLocks,
  LOCK_UNLOCK_COOLDOWN_MS,
  matchPortfoliosForAccount,
  normalizeLocks,
} from './tradingLocks';

const acct = (id: string | number) => [{ provider: 'ctrader', externalAccountId: String(id) }];

describe('matchPortfoliosForAccount', () => {
  it('returns empty when nothing is linked', () => {
    expect(matchPortfoliosForAccount([], 123)).toEqual([]);
    expect(
      matchPortfoliosForAccount([{ id: 'p1', accounts: acct(999) }], 123)
    ).toEqual([]);
    expect(
      matchPortfoliosForAccount([{ id: 'p1', accounts: [{ provider: 'mt5', externalAccountId: '123' }] }], 123)
    ).toEqual([]);
  });

  it('matches with string/number coercion', () => {
    const rows = [{ id: 'p1', name: 'Main', accounts: acct(123) }];
    expect(matchPortfoliosForAccount(rows, 123).map((b) => b.id)).toEqual(['p1']);
    expect(matchPortfoliosForAccount(rows, '123' as any).map((b) => b.id)).toEqual(['p1']);
  });

  it('orders live before archived, default first, then oldest', () => {
    const rows = [
      { id: 'arch', accounts: acct(7), is_archived: true, created_at: '2024-01-01' },
      { id: 'new', accounts: acct(7), created_at: '2026-01-01' },
      { id: 'old', accounts: acct(7), created_at: '2025-01-01' },
      { id: 'def', accounts: acct(7), is_default: true, created_at: '2026-06-01' },
    ];
    expect(matchPortfoliosForAccount(rows, 7).map((b) => b.id)).toEqual([
      'def',
      'old',
      'new',
      'arch',
    ]);
  });

  it('keeps archived rows visible (caller filters) with flags parsed', () => {
    const rows = [{ id: 'p1', accounts: acct(5), is_archived: true, is_default: true }];
    expect(matchPortfoliosForAccount(rows, 5)).toEqual([
      { id: 'p1', name: null, isDefault: true, isArchived: true, createdAt: null },
    ]);
  });
});

describe('server trading lock evaluation', () => {
  const maxLocks = () => ({
    maxTrades: { enabled: true, maxPerDay: 2, unlockRequestedAt: null },
  });

  it('does not apply a pending raise before it elapses', () => {
    const now = Date.parse('2026-01-02T10:00:00Z');
    const locks = {
      maxTrades: {
        ...maxLocks().maxTrades,
        pendingChange: { value: { maxPerDay: 5 }, requestedAt: new Date(now - 60_000).toISOString() },
      },
    };
    expect(evaluateLocks(locks, { symbolId: null, volumeLots: 0.01, fillsToday: 2 }, now).allowed).toBe(false);
  });

  it('merges an elapsed pending raise', () => {
    const now = Date.parse('2026-01-02T10:00:00Z');
    const locks = {
      maxTrades: {
        ...maxLocks().maxTrades,
        pendingChange: {
          value: { maxPerDay: 5 },
          requestedAt: new Date(now - LOCK_UNLOCK_COOLDOWN_MS - 1000).toISOString(),
        },
      },
    };
    const normalized = normalizeLocks(locks, now);
    expect(normalized?.maxTrades?.maxPerDay).toBe(5);
    expect(normalized?.maxTrades?.pendingChange).toBeNull();
    expect(evaluateLocks(locks, { symbolId: null, volumeLots: 0.01, fillsToday: 2 }, now).allowed).toBe(true);
  });

  it('ignores future pending timestamps instead of clamping them', () => {
    const now = Date.parse('2026-01-02T10:00:00Z');
    const locks = {
      maxTrades: {
        ...maxLocks().maxTrades,
        pendingChange: { value: { maxPerDay: 5 }, requestedAt: new Date(now + 60_000).toISOString() },
      },
    };
    const normalized = normalizeLocks(locks, now);
    expect(normalized?.maxTrades?.maxPerDay).toBe(2);
    expect(normalized?.maxTrades?.pendingChange).not.toBeNull();
    expect(evaluateLocks(locks, { symbolId: null, volumeLots: 0.01, fillsToday: 2 }, now).allowed).toBe(false);
  });

  it('blocks an invalid stored lot range with the shared message', () => {
    const locks = { lotGuard: { enabled: true, minLots: 1, maxLots: 0.5, unlockRequestedAt: null } };
    const verdict = evaluateLocks(locks, { symbolId: null, volumeLots: 0.75, fillsToday: 0 });
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed === false) {
      expect(verdict.rule).toBe('lotGuard');
      expect(verdict.message).toBe('Lot limits are invalid (min above max). Fix them in Trading Locks.');
    }
  });

  it('blocks unknown fills while maxTrades is active', () => {
    const verdict = evaluateLocks(maxLocks(), { symbolId: null, volumeLots: 0.01, fillsToday: null });
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed === false) {
      expect(verdict.rule).toBe('maxTrades');
      expect(verdict.reason).toBe('count_unavailable');
      expect(verdict.message).toBe("Couldn't confirm today's trade count. Try again in a moment.");
    }
    expect(evaluateLocks({}, { symbolId: null, volumeLots: 0.01, fillsToday: null }).allowed).toBe(true);
  });
});
