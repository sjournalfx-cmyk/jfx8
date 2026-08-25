// Pure cTrader trendbar helpers — plain ESM so BOTH the Node runtime
// (vite.config.mjs dev middleware) and the TypeScript bundle
// (api/_lib/ctraderHarvester.ts) can use them without a transform step.
export const CTRADER_PRICE_SCALE = 100000;

/** Normalize any broker symbol spelling (EURUSD / eur/usd / GBP_JPY) for matching. */
export function normalizeSymbol(name) {
  return String(name || '').toUpperCase().replace(/[/_]/g, '');
}

/**
 * Decode ProtoOAGetTrendbarsRes trendbar entries into OHLC candles.
 * Prices arrive as integers scaled by 10^5; `low` is absolute while
 * open/high/close are deltas from it. `digits` only controls display rounding.
 */
export function decodeTrendbars(bars, digits = 5) {
  const candles = [];
  if (!Array.isArray(bars)) return candles;
  const round = (v) => Number(v.toFixed(digits));

  for (const bar of bars) {
    if (!bar || typeof bar !== 'object') continue;
    const low = Number(bar.low);
    const dOpen = Number(bar.deltaOpen);
    const dHigh = Number(bar.deltaHigh);
    const dClose = Number(bar.deltaClose);
    const tsMin = Number(bar.utcTimestampInMinutes);
    if (![low, dOpen, dHigh, dClose, tsMin].every(Number.isFinite)) continue;

    let timeInSeconds;
    if (Number.isFinite(tsMin) && tsMin > 0) {
      timeInSeconds = tsMin * 60;
    } else {
      const tsMs = Number(bar.utcTimestamp ?? bar.timestamp);
      timeInSeconds = Number.isFinite(tsMs) && tsMs > 0 ? Math.floor(tsMs / 1000) : Math.floor(Date.now() / 1000);
    }

    candles.push({
      time: timeInSeconds,
      open: round(low / CTRADER_PRICE_SCALE + dOpen / CTRADER_PRICE_SCALE),
      high: round(low / CTRADER_PRICE_SCALE + dHigh / CTRADER_PRICE_SCALE),
      low: round(low / CTRADER_PRICE_SCALE),
      close: round(low / CTRADER_PRICE_SCALE + dClose / CTRADER_PRICE_SCALE),
    });
  }

  return candles.sort((a, b) => a.time - b.time);
}

/**
 * Merge two bar lists by open time; on overlap the INCOMING bar wins.
 * Same semantics as lib/candleStore.mergeBars — duplicated here because api/
 * code must not import from the Vite client bundle.
 */
export function mergeBars(existing, incoming) {
  const byTime = new Map();
  for (const list of [existing, incoming]) {
    if (!Array.isArray(list)) continue;
    for (const bar of list) {
      if (bar && [bar.time, bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)) {
        byTime.set(bar.time, bar);
      }
    }
  }
  return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
}

export function capToNewest(bars, maxBars) {
  return bars.length <= maxBars ? bars : bars.slice(-maxBars);
}
