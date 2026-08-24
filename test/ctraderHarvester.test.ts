import { describe, it, expect } from 'vitest';
import { decodeTrendbars, normalizeSymbol, mergeBars, type RawTrendbar } from '../api/_lib/ctraderHarvester';

describe('decodeTrendbars', () => {
  // Fixture mirrors ProtoOAGetTrendbarsRes: prices are integers scaled by 10^5,
  // low is absolute; open/high/close are deltas from low. utcTimestampInMinutes
  // is minutes since epoch.
  const bars: RawTrendbar[] = [
    { utcTimestampInMinutes: 28333333, low: 100000, deltaOpen: 50000, deltaHigh: 80000, deltaClose: 70000 },
    { utcTimestampInMinutes: 28333334, low: 200000, deltaOpen: 0, deltaHigh: 25000, deltaClose: -10000 },
    { utcTimestampInMinutes: 28333335, low: 105000, deltaOpen: 10000, deltaHigh: 30000, deltaClose: 20000 },
  ];

  it('decodes scaled integer trendbars into OHLC candles', () => {
    const candles = decodeTrendbars(bars);
    expect(candles).toHaveLength(3);

    expect(candles[0]).toEqual({ time: 28333333 * 60, open: 1.5, high: 1.8, low: 1.0, close: 1.7 });
    // negative deltaClose allowed (close below low? no — cTrader guarantees
    // low <= close, but decoder must not clamp or reorder)
    expect(candles[1]).toEqual({ time: 28333334 * 60, open: 2.0, high: 2.25, low: 2.0, close: 1.9 });
  });

  it('sorts output by time ascending', () => {
    const shuffled = [...bars].reverse();
    const candles = decodeTrendbars(shuffled);
    for (let i = 1; i < candles.length; i++) {
      expect(candles[i].time).toBeGreaterThanOrEqual(candles[i - 1].time);
    }
  });

  it('honors digits for display rounding only', () => {
    const candles = decodeTrendbars([{ utcTimestampInMinutes: 100, low: 151111, deltaOpen: 22222, deltaHigh: 33333, deltaClose: 44444 }], 3);
    expect(candles[0].open).toBeCloseTo(1.733, 3);
  });

  it('drops malformed bars instead of throwing', () => {
    const candles = decodeTrendbars([
      null as any,
      {},
      { utcTimestampInMinutes: 100, low: 'x', deltaOpen: 1, deltaHigh: 1, deltaClose: 1 },
      bars[0],
    ] as any);
    expect(candles).toHaveLength(1);
  });
});

describe('normalizeSymbol', () => {
  it('strips separators and uppercases', () => {
    expect(normalizeSymbol('eur/usd')).toBe('EURUSD');
    expect(normalizeSymbol('GBP_JPY')).toBe('GBPJPY');
    expect(normalizeSymbol('XAUUSD.a')).toBe('XAUUSD.A');
  });
});

describe('mergeBars', () => {
  const t = (n: number, p: number) => ({ time: n, open: p, high: p, low: p, close: p });

  it('dedupes by bar time with incoming winning on overlap', () => {
    const existing = [t(1, 10), t(2, 20)];
    const incoming = [t(2, 99), t(3, 30)];
    expect(mergeBars(existing, incoming)).toEqual([t(1, 10), t(2, 99), t(3, 30)]);
  });

  it('tolerates null/undefined sides', () => {
    expect(mergeBars(null, [t(1, 1)])).toEqual([t(1, 1)]);
    expect(mergeBars([t(1, 1)], undefined)).toEqual([t(1, 1)]);
    expect(mergeBars(null, null)).toEqual([]);
  });
});
