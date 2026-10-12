import { describe, expect, it } from 'vitest';
import {
  canonicalOrderParams,
  checkScopes,
  extractRawKey,
  hashOrderParams,
  JFX_PAT_PATTERN,
  resolveSymbolId,
  suggestSymbols,
} from './apiKeys';

describe('JFX_PAT_PATTERN', () => {
  it('accepts well-formed keys and rejects others', () => {
    expect(JFX_PAT_PATTERN.test('jfx_pat_abcdefgh_1234567890ABCDEF1234567890abcdef')).toBe(true);
    expect(JFX_PAT_PATTERN.test('Bearer jfx_pat_abcdefgh_1234567890ABCDEF1234567890abcdef')).toBe(false);
    expect(JFX_PAT_PATTERN.test('raw-ctrader-token')).toBe(false);
    expect(JFX_PAT_PATTERN.test('')).toBe(false);
  });
});

describe('extractRawKey', () => {
  it('reads Authorization, X-API-Key and X-Access-Token, stripping Bearer', () => {
    expect(extractRawKey({ authorization: 'Bearer abc123' })).toBe('abc123');
    expect(extractRawKey({ Authorization: 'Bearer abc123' })).toBe('abc123');
    expect(extractRawKey({ 'x-api-key': 'jfx_pat_x' })).toBe('jfx_pat_x');
    expect(extractRawKey({ 'x-access-token': 'tok' })).toBe('tok');
    expect(extractRawKey({})).toBe('');
    expect(extractRawKey(undefined)).toBe('');
  });
});

describe('checkScopes', () => {
  it('grants read to trades:write holders', () => {
    expect(checkScopes(['trades:read'], 'trades:read')).toBe(true);
    expect(checkScopes(['trades:write'], 'trades:read')).toBe(true);
    expect(checkScopes(['trades:write'], 'trades:write')).toBe(true);
    expect(checkScopes(['trades:read'], 'trades:write')).toBe(false);
    expect(checkScopes([], 'trades:read')).toBe(false);
    expect(checkScopes(undefined, 'trades:read')).toBe(false);
  });
});

describe('resolveSymbolId', () => {
  const list = [
    { symbolId: 1, symbolName: 'EURUSD' },
    { symbolId: 2, symbolName: 'EURUSDm' },
    { symbolId: 3, symbolName: 'USDJPY', digits: 3 },
  ];

  it('prefers the exact listing over fuzzy matches', () => {
    // EURUSD must never resolve to EURUSDm when EURUSD exists.
    expect(resolveSymbolId(list, 'EURUSD')).toEqual({ symbolId: 1, symbolName: 'EURUSD', digits: 5 });
    expect(resolveSymbolId(list, 'eur/usd')).toEqual({ symbolId: 1, symbolName: 'EURUSD', digits: 5 });
  });

  it('falls back to fuzzy matching and keeps broker digits', () => {
    expect(resolveSymbolId(list, 'USDJPY')).toEqual({ symbolId: 3, symbolName: 'USDJPY', digits: 3 });
    expect(resolveSymbolId([{ symbolId: 9, symbolName: 'EURUSD.pro' }], 'EURUSD')?.symbolId).toBe(9);
  });

  it('returns null for unknown or blank symbols', () => {
    expect(resolveSymbolId(list, 'GBPXYZ')).toBeNull();
    expect(resolveSymbolId(list, '')).toBeNull();
    expect(resolveSymbolId([], 'EURUSD')).toBeNull();
  });
});

describe('suggestSymbols', () => {
  it('returns close broker names for 400 hints', () => {
    const list = [
      { symbolId: 1, symbolName: 'EURUSD' },
      { symbolId: 2, symbolName: 'EURUSDm' },
      { symbolId: 3, symbolName: 'GBPUSD' },
    ];
    expect(suggestSymbols(list, 'EURUS')).toEqual(['EURUSD', 'EURUSDm']);
    expect(suggestSymbols(list, 'ZZZ')).toEqual([]);
  });
});

describe('order params canonicalization', () => {
  const base = {
    accountId: 123,
    symbolId: 1,
    side: 'buy',
    orderType: 1,
    volumeCents: 100000,
    limitPrice: null,
    stopPrice: null,
    stopLoss: 1.075,
    takeProfit: 1.095,
  };

  it('is stable regardless of key order or side casing', () => {
    const a = canonicalOrderParams(base);
    const b = canonicalOrderParams({ ...base, side: 'BUY' });
    expect(a).toBe(b);
    expect(hashOrderParams(base)).toBe(hashOrderParams({ ...base }));
  });

  it('changes the hash when any order field changes', () => {
    const h = hashOrderParams(base);
    expect(hashOrderParams({ ...base, side: 'sell' })).not.toBe(h);
    expect(hashOrderParams({ ...base, volumeCents: 200000 })).not.toBe(h);
    expect(hashOrderParams({ ...base, stopLoss: 1.076 })).not.toBe(h);
    expect(hashOrderParams({ ...base, accountId: 999 })).not.toBe(h);
  });
});
