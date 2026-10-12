import { describe, expect, it } from 'vitest';
import { matchPortfoliosForAccount } from './tradingLocks';

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
