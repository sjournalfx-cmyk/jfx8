import { Candle } from '../types';

// Persistent incremental candle history for the Backtest Lab.
//
// Every fetched series is stored per `symbol_timeframe` and reused forever:
// opening a chart you have loaded before renders instantly from storage, and
// only bars NEWER than the last saved bar are fetched from the network.
// Full fetches happen exclusively when nothing is stored yet.
//
// Payload shape (v2): { v: 2, timestamp, lastAccess, data: Candle[] }
// Legacy payloads ({ timestamp, data } or a raw array) remain readable.

const KEY_PREFIX = 'jfx_backtest_cache_';

export const MAX_BARS_PER_SERIES = 2000;
const MAX_STORE_KEYS = 120; // LRU bound across all symbol_tf series

export interface CandleSeriesMeta {
    lastTime: number;
    barCount: number;
    savedAt: number;
}

export const buildSeriesKey = (symbol: string, timeframe: string) => `${KEY_PREFIX}${symbol}_${timeframe}`;

const isValidCandle = (c: any): c is Candle =>
    c &&
    typeof c.time === 'number' && isFinite(c.time) &&
    typeof c.open === 'number' && typeof c.high === 'number' &&
    typeof c.low === 'number' && typeof c.close === 'number';

/** Read a stored series. Returns null when absent/corrupt. Never throws. */
export const loadSeries = (symbol: string, timeframe: string): Candle[] | null => {
    try {
        const raw = localStorage.getItem(buildSeriesKey(symbol, timeframe));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const data = Array.isArray(parsed) ? parsed : parsed?.data;
        if (!Array.isArray(data)) return null;
        const candles = data.filter(isValidCandle);
        if (candles.length === 0) return null;
        touchAccess(symbol, timeframe);
        return candles.sort((a, b) => a.time - b.time);
    } catch {
        return null;
    }
};

/**
 * Merge incoming bars into an existing series. Dedupe key is the bar open
 * time; on overlap the INCOMING bar wins (only ever affects the most recent
 * live bar). Result is sorted ascending. Either side may be empty/null.
 */
export const mergeBars = (existing: Candle[] | null | undefined, incoming: Candle[] | null | undefined): Candle[] => {
    const byTime = new Map<number, Candle>();
    for (const list of [existing, incoming]) {
        if (!Array.isArray(list)) continue;
        for (const bar of list) {
            if (isValidCandle(bar)) byTime.set(bar.time, bar);
        }
    }
    return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
};

/** Cheap metadata lookup without parsing full arrays into app state twice. */
export const peekMeta = (symbol: string, timeframe: string): CandleSeriesMeta | null => {
    const series = loadSeries(symbol, timeframe);
    if (!series || series.length === 0) return null;
    return {
        lastTime: series[series.length - 1].time,
        barCount: series.length,
        savedAt: readSavedAt(symbol, timeframe)
    };
};

export interface CachedSeriesInfo {
    symbol: string;
    timeframe: string;
    barCount: number;
    lastTime: number;
    lastAccess: number;
}

/**
 * Enumerate every stored series (for the Start Screen's "Continue where you
 * left off" cards). Parses each payload once; corrupt entries are skipped.
 * Sorted by most-recently-accessed first. Never throws.
 */
export const listCachedSeries = (): CachedSeriesInfo[] => {
    const results: CachedSeriesInfo[] = [];
    try {
        for (const key of listStoredKeys()) {
            const suffix = key.slice(KEY_PREFIX.length);
            const sep = suffix.lastIndexOf('_');
            if (sep <= 0) continue;
            const symbol = suffix.slice(0, sep);
            const timeframe = suffix.slice(sep + 1);
            if (!symbol || !timeframe) continue;
            try {
                const raw = localStorage.getItem(key);
                if (!raw) continue;
                const parsed = JSON.parse(raw);
                const data = Array.isArray(parsed) ? parsed : parsed?.data;
                if (!Array.isArray(data)) continue;
                const candles = data.filter(isValidCandle);
                if (candles.length === 0) continue;
                results.push({
                    symbol,
                    timeframe,
                    barCount: candles.length,
                    lastTime: candles[candles.length - 1].time,
                    lastAccess: (Array.isArray(parsed) ? 0 : (parsed?.lastAccess || parsed?.timestamp || 0)) || 0
                });
            } catch { /* skip corrupt entry */ }
        }
    } catch { /* storage unavailable */ }
    return results.sort((a, b) => b.lastAccess - a.lastAccess);
};

const readSavedAt = (symbol: string, timeframe: string): number => {
    try {
        const raw = localStorage.getItem(buildSeriesKey(symbol, timeframe));
        if (!raw) return 0;
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? 0 : (parsed?.timestamp || 0);
    } catch {
        return 0;
    }
};

const listStoredKeys = (): string[] => {
    const keys: string[] = [];
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(KEY_PREFIX)) keys.push(k);
        }
    } catch { /* storage unavailable */ }
    return keys;
};

const readLastAccess = (key: string): number => {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return 0;
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? 0 : (parsed?.lastAccess || parsed?.timestamp || 0);
    } catch {
        return 0;
    }
};

const touchAccess = (symbol: string, timeframe: string) => {
    // Refresh lastAccess so LRU eviction keeps recently viewed history alive.
    try {
        const key = buildSeriesKey(symbol, timeframe);
        const raw = localStorage.getItem(key);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return; // legacy payload — leave untouched
        localStorage.setItem(key, JSON.stringify({ ...parsed, lastAccess: Date.now() }));
    } catch { /* non-fatal */ }
};

const evictLRUExcept = (keepKey: string) => {
    let evicted = 0;
    try {
        const keys = listStoredKeys()
            .filter(k => k !== keepKey)
            .map(k => ({ k, at: readLastAccess(k) }))
            .sort((a, b) => a.at - b.at);
        // Evict the oldest quarter (or at least one entry).
        const count = Math.max(1, Math.floor(keys.length / 4));
        for (let i = 0; i < count && i < keys.length; i++) {
            localStorage.removeItem(keys[i].k);
            evicted++;
        }
    } catch { /* non-fatal */ }
    return evicted;
};

const enforceKeyBudget = () => {
    try {
        const keys = listStoredKeys();
        if (keys.length <= MAX_STORE_KEYS) return;
        const ordered = keys
            .map(k => ({ k, at: readLastAccess(k) }))
            .sort((a, b) => a.at - b.at);
        const excess = keys.length - MAX_STORE_KEYS;
        for (let i = 0; i < excess && i < ordered.length; i++) {
            localStorage.removeItem(ordered[i].k);
        }
    } catch { /* non-fatal */ }
};

/**
 * Persist a series (newest MAX_BARS_PER_SERIES bars). On quota errors the
 * oldest other series are evicted and the write retried once; if storage is
 * still unavailable the failure is swallowed — the app keeps working with
 * in-memory state as before this store existed.
 */
export const saveSeries = (symbol: string, timeframe: string, bars: Candle[]): boolean => {
    if (!Array.isArray(bars) || bars.length === 0) return false;
    const capped = bars.slice(-MAX_BARS_PER_SERIES);
    const payload = {
        v: 2,
        timestamp: Date.now(),
        lastAccess: Date.now(),
        data: capped
    };
    const key = buildSeriesKey(symbol, timeframe);
    try {
        localStorage.setItem(key, JSON.stringify(payload));
        enforceKeyBudget();
        return true;
    } catch {
        try {
            evictLRUExcept(key);
            localStorage.setItem(key, JSON.stringify(payload));
            return true;
        } catch {
            return false;
        }
    }
};
