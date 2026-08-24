import { describe, it, expect, beforeEach } from 'vitest';
import {
    loadSeries,
    mergeBars,
    saveSeries,
    peekMeta,
    listCachedSeries,
    MAX_BARS_PER_SERIES
} from '../lib/candleStore';

const bar = (time: number, close = 1): any => ({ time, open: close - 0.1, high: close + 0.2, low: close - 0.2, close });

const storedKeys = () =>
    Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!)
        .filter(k => k.startsWith('jfx_backtest_cache_'));

describe('candleStore', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    describe('mergeBars', () => {
        it('returns sorted union of both inputs', () => {
            const existing = [bar(300), bar(100)];
            const incoming = [bar(200)];
            const merged = mergeBars(existing, incoming);
            expect(merged.map(b => b.time)).toEqual([100, 200, 300]);
        });

        it('incoming wins on overlapping timestamps', () => {
            const existing = [bar(100, 1.0), bar(200, 2.0)];
            const updated = bar(200, 9.9);
            const merged = mergeBars(existing, [updated]);
            expect(merged.length).toBe(2);
            expect(merged[1].close).toBe(9.9);
        });

        it('handles null/undefined sides and invalid bars', () => {
            expect(mergeBars(null, null)).toEqual([]);
            expect(mergeBars(null, [bar(5)])).toHaveLength(1);
            expect(mergeBars([{ time: NaN } as any], [bar(5)])).toHaveLength(1);
        });
    });

    describe('saveSeries / loadSeries round-trip', () => {
        it('saves and loads a series sorted ascending', () => {
            saveSeries('EURUSD', 'H1', [bar(30), bar(10), bar(20)]);
            const loaded = loadSeries('EURUSD', 'H1');
            expect(loaded?.map(b => b.time)).toEqual([10, 20, 30]);
        });

        it('caps the series to the newest MAX_BARS_PER_SERIES bars', () => {
            const bars = Array.from({ length: MAX_BARS_PER_SERIES + 500 }, (_, i) => bar(i));
            saveSeries('XAUUSD', 'M15', bars);
            const loaded = loadSeries('XAUUSD', 'M15');
            expect(loaded).toHaveLength(MAX_BARS_PER_SERIES);
            expect(loaded![0].time).toBe(500);
            expect(loaded!.at(-1)!.time).toBe(MAX_BARS_PER_SERIES + 499);
        });

        it('reads legacy v1 payloads ({ timestamp, data })', () => {
            localStorage.setItem(
                'jfx_backtest_cache_GBPUSD_H4',
                JSON.stringify({ timestamp: 123, data: [bar(7), bar(3)] })
            );
            expect(loadSeries('GBPUSD', 'H4')?.map(b => b.time)).toEqual([3, 7]);
            expect(peekMeta('GBPUSD', 'H4')?.lastTime).toBe(7);
        });

        it('returns null for corrupt or missing entries', () => {
            expect(loadSeries('NOPE', 'H1')).toBeNull();
            localStorage.setItem('jfx_backtest_cache_BAD_H1', '{not json');
            expect(loadSeries('BAD', 'H1')).toBeNull();
        });

        it('filters out malformed candles', () => {
            localStorage.setItem(
                'jfx_backtest_cache_DIRTY_H1',
                JSON.stringify({ v: 2, timestamp: 1, lastAccess: 1, data: [bar(1), { garbage: true }, null] })
            );
            expect(loadSeries('DIRTY', 'H1')).toHaveLength(1);
        });
    });

    describe('peekMeta', () => {
        it('reports lastTime, count and savedAt', () => {
            saveSeries('EURJPY', 'D1', [bar(100), bar(200)]);
            const meta = peekMeta('EURJPY', 'D1');
            expect(meta).not.toBeNull();
            expect(meta!.lastTime).toBe(200);
            expect(meta!.barCount).toBe(2);
            expect(meta!.savedAt).toBeGreaterThan(0);
        });

        it('is null when nothing is stored', () => {
            expect(peekMeta('GHOST', 'M5')).toBeNull();
        });
    });

    describe('listCachedSeries', () => {
        it('enumerates stored series with symbol, tf and counts', () => {
            saveSeries('EURUSD', 'H1', [bar(10), bar(20)]);
            saveSeries('XAUUSD', 'M15', [bar(30)]);
            const list = listCachedSeries();
            expect(list).toHaveLength(2);
            const eurusd = list.find(s => s.symbol === 'EURUSD');
            expect(eurusd?.timeframe).toBe('H1');
            expect(eurusd?.barCount).toBe(2);
            expect(eurusd?.lastTime).toBe(20);
            expect(eurusd!.lastAccess).toBeGreaterThan(0);
        });

        it('sorts by most-recently-accessed first', () => {
            localStorage.setItem(
                'jfx_backtest_cache_OLD_H1',
                JSON.stringify({ v: 2, timestamp: 1000, lastAccess: 1000, data: [bar(1)] })
            );
            saveSeries('FRESH', 'H1', [bar(2)]); // lastAccess = now
            const list = listCachedSeries();
            expect(list[0].symbol).toBe('FRESH');
            expect(list[1].symbol).toBe('OLD');
        });

        it('skips corrupt entries and returns [] when storage is empty', () => {
            expect(listCachedSeries()).toEqual([]);
            localStorage.setItem('jfx_backtest_cache_BAD_H1', '{not json');
            localStorage.setItem('jfx_backtest_cache_DIRTY_H1', JSON.stringify({ v: 2, lastAccess: 5, data: [null] }));
            expect(listCachedSeries()).toEqual([]);
        });
    });

    describe('quota handling / LRU eviction', () => {
        it('evicts least-recently-accessed series when the first write hits quota', () => {
            // Seed several old series with old lastAccess values.
            for (let i = 0; i < 8; i++) {
                localStorage.setItem(
                    `jfx_backtest_cache_OLD${i}_H1`,
                    JSON.stringify({ timestamp: 1000 + i, lastAccess: 1000 + i, data: [bar(i)] })
                );
            }

            const original = Storage.prototype.setItem;
            let failNext = true;
            Storage.prototype.setItem = function (k: string, v: string) {
                if (failNext) {
                    failNext = false;
                    throw new DOMException('QuotaExceededError');
                }
                return original.call(this, k, v);
            };

            try {
                const ok = saveSeries('QUOTA_VICTIM', 'H1', [bar(12345)]);
                expect(ok).toBe(true);
                expect(loadSeries('QUOTA_VICTIM', 'H1')).toHaveLength(1);
                // At least one OLD* series was evicted to make room.
                const remainingOld = storedKeys().filter(k => k.includes('_OLD'));
                expect(remainingOld.length).toBeLessThan(8);
            } finally {
                Storage.prototype.setItem = original;
            }
        });
    });
});
