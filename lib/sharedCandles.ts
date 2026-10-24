import { Candle } from '../types';
import { apiUrl } from './capacitor';
import { mergeBars } from './candleStore';
import { getSessionToken } from './supabase';

// Client helper for the SHARED candle store (server-harvested cTrader history
// published to Supabase via /api/candles/harvest). Lets the Backtest Lab load
// charts without any personal cTrader connection.
//
// When a shared series is stale (or missing) and the signed-in user has
// cTrader connected, we transparently top up from the live broker endpoint
// (/api/ctrader/trade?action=candles) and merge by bar time. If they have no
// cTrader connection the shared bars are still returned together with their
// last-updated metadata so the UI can say how old they are.

export const normSymbol = (s: string) => s.toUpperCase().replace(/[/_]/g, '');

export interface SharedCandlesMeta {
  stale: boolean;
  ageHours: number | null;
  updatedAt: string | null;
}

export interface SharedCandlesResult extends SharedCandlesMeta {
  candles: Candle[];
  source: 'shared' | 'live' | 'merged';
}

const isValidCandle = (b: any): b is Candle =>
  b &&
  typeof b.time === 'number' && isFinite(b.time) &&
  typeof b.open === 'number' && typeof b.high === 'number' &&
  typeof b.low === 'number' && typeof b.close === 'number';

async function fetchSharedRaw(
  symbol: string,
  timeframe: string,
  since?: number
): Promise<SharedCandlesResult | null> {
  try {
    const params = new URLSearchParams({
      symbol: normSymbol(symbol),
      timeframe: timeframe.toUpperCase(),
    });
    if (since && since > 0) params.set('since', String(since));
    const res = await fetch(apiUrl(`/api/candles?${params.toString()}`));
    if (!res.ok) return null;
    const data = await res.json();
    const candles: Candle[] = Array.isArray(data.bars) ? data.bars.filter(isValidCandle) : [];
    return {
      candles,
      stale: Boolean(data.stale),
      ageHours: typeof data.age_hours === 'number' ? data.age_hours : null,
      updatedAt: typeof data.updated_at === 'string' ? data.updated_at : null,
      source: 'shared',
    };
  } catch {
    return null;
  }
}

/**
 * Live per-user candles straight from the caller's own cTrader account.
 * Returns null when signed out, cTrader is not connected, or the request fails
 * — callers then keep whatever the shared store had.
 */
export async function fetchLiveCtraderCandles(
  symbol: string,
  timeframe: string,
  since?: number
): Promise<Candle[] | null> {
  try {
    const token = await getSessionToken();
    if (!token) return null;
    const params = new URLSearchParams({
      symbol: normSymbol(symbol),
      timeframe: timeframe.toUpperCase(),
      count: '2000',
    });
    // The route accepts unix seconds and converts to cTrader milliseconds.
    if (since && since > 0) params.set('from', String(since));
    const res = await fetch(apiUrl(`/api/ctrader/trade?action=candles&${params.toString()}`), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    const candles: Candle[] = Array.isArray(data.bars) ? data.bars.filter(isValidCandle) : [];
    return candles.length > 0 ? candles : null;
  } catch {
    return null;
  }
}

/**
 * Shared-first load with live fallback/top-up. Returns null only when both
 * sources have nothing for this symbol/timeframe.
 */
export async function fetchSharedCandlesDetailed(
  symbol: string,
  timeframe: string,
  since?: number
): Promise<SharedCandlesResult | null> {
  const shared = await fetchSharedRaw(symbol, timeframe, since);

  // Fresh shared data (including "no new bars since <time>") needs no broker
  // round-trip.
  if (shared && !shared.stale) return shared;

  const live = await fetchLiveCtraderCandles(symbol, timeframe, since);
  if (live && live.length > 0) {
    const merged = mergeBars(shared?.candles, live);
    return {
      candles: merged,
      stale: false,
      ageHours: 0,
      updatedAt: new Date().toISOString(),
      source: shared && shared.candles.length > 0 ? 'merged' : 'live',
    };
  }

  // No live fallback available (signed out / cTrader not connected / broker
  // error): keep the shared bars and expose how old they are.
  return shared;
}

/**
 * Fetch a shared series. Returns null when the store doesn't have it yet or
 * the network fails — callers fall back to the personal cTrader flow.
 * `since` (unix seconds) limits the response to bars newer than the caller's
 * newest local bar, for incremental top-ups.
 */
export async function fetchSharedCandles(
  symbol: string,
  timeframe: string,
  since?: number
): Promise<Candle[] | null> {
  const result = await fetchSharedCandlesDetailed(symbol, timeframe, since);
  return result && result.candles.length > 0 ? result.candles : null;
}

/** Metadata-only probe: does the shared store hold this series at all? */
export async function sharedSeriesExists(symbol: string, timeframe: string): Promise<boolean> {
  try {
    const params = new URLSearchParams({ symbol: normSymbol(symbol), timeframe: timeframe.toUpperCase() });
    const res = await fetch(apiUrl(`/api/candles?${params.toString()}`));
    return res.ok;
  } catch {
    return false;
  }
}
