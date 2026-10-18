import { Candle } from '../types';
import { apiUrl } from './capacitor';

// Client helper for the SHARED candle store (server-harvested cTrader history
// published to Supabase via /api/candles/harvest). Lets the Backtest Lab load
// charts without any personal cTrader connection.

export const normSymbol = (s: string) => s.toUpperCase().replace(/[/_]/g, '');

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
  try {
    const params = new URLSearchParams({
      symbol: normSymbol(symbol),
      timeframe: timeframe.toUpperCase(),
    });
    if (since && since > 0) params.set('since', String(since));
    const res = await fetch(apiUrl(`/api/candles?${params.toString()}`));
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data.bars) || data.bars.length === 0) return null;
    const candles: Candle[] = data.bars.filter(
      (b: any) =>
        b &&
        typeof b.time === 'number' && isFinite(b.time) &&
        typeof b.open === 'number' && typeof b.high === 'number' &&
        typeof b.low === 'number' && typeof b.close === 'number'
    );
    return candles.length > 0 ? candles : null;
  } catch {
    return null;
  }
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
