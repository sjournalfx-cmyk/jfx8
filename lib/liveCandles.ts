import type { Candle } from '../types';

/** Seconds per bar — mirrors BACKTEST_TF_SECONDS plus W1. */
export const LIVE_TF_SECONDS: Record<string, number> = {
  M1: 60,
  M5: 300,
  M15: 900,
  M30: 1800,
  H1: 3600,
  H4: 14400,
  D1: 86400,
  W1: 604800,
};

/** In-memory cap for the live series (history top-up keeps it fresh). */
export const MAX_LIVE_BARS = 2000;

export interface RawSpot {
  bid?: number | string | null;
  ask?: number | string | null;
}

/**
 * Mid price in human units, or null when the tick carries no usable price.
 * A one-sided tick falls back to the side present (better than dropping it).
 */
export function midPrice(tick: RawSpot, digits: number): number | null {
  const bid = tick?.bid === undefined || tick?.bid === null || tick?.bid === '' ? NaN : Number(tick.bid);
  const ask = tick?.ask === undefined || tick?.ask === null || tick?.ask === '' ? NaN : Number(tick.ask);
  const divisor = Math.pow(10, digits);
  if (Number.isFinite(bid) && Number.isFinite(ask)) {
    return Number((((bid + ask) / 2 / divisor)).toFixed(digits));
  }
  if (Number.isFinite(bid)) return Number((bid / divisor).toFixed(digits));
  if (Number.isFinite(ask)) return Number((ask / divisor).toFixed(digits));
  return null;
}

/** Bar open time (unix seconds) for `nowMs` — local arrival time, since the broker sends no tick timestamps. */
export function bucketTime(nowMs: number, tfSec: number): number {
  return Math.floor(Math.floor(nowMs / 1000) / tfSec) * tfSec;
}

/**
 * Fold one spot tick into a candle series (pure — returns a new array).
 * Same bucket: updates high/low/close in place-copy. New bucket: pushes a
 * fresh bar (open = tick price). Trims to `maxBars` newest.
 */
export function applyTick(
  bars: Candle[],
  tick: RawSpot,
  nowMs: number,
  timeframe: string,
  digits: number,
  maxBars: number = MAX_LIVE_BARS
): Candle[] {
  const price = midPrice(tick, digits);
  if (price === null || !Number.isFinite(price)) return bars;
  const tfSec = LIVE_TF_SECONDS[String(timeframe || 'H1').toUpperCase()] || 3600;
  const bucket = bucketTime(nowMs, tfSec);
  const next = bars.slice();
  const last = next[next.length - 1];
  if (last && Number(last.time) === bucket) {
    next[next.length - 1] = {
      ...last,
      high: Math.max(Number(last.high), price),
      low: Math.min(Number(last.low), price),
      close: price,
    };
    return next;
  }
  // Ignore out-of-order ticks older than the newest bar (reconnect replays).
  if (last && bucket < Number(last.time)) return bars;
  next.push({ time: bucket, open: price, high: price, low: price, close: price });
  return next.length > maxBars ? next.slice(next.length - maxBars) : next;
}

/**
 * Merge freshly fetched history under/over the live series (dedupe by time,
 * fetched wins on overlap). Keeps chronological order + cap.
 */
export function mergeHistory(live: Candle[], history: Candle[], maxBars: number = MAX_LIVE_BARS): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const b of live || []) {
    const t = Number(b?.time);
    if (Number.isFinite(t)) byTime.set(t, b);
  }
  for (const b of history || []) {
    const t = Number(b?.time);
    if (Number.isFinite(t)) byTime.set(t, b);
  }
  const merged = [...byTime.values()].sort((a, b) => Number(a.time) - Number(b.time));
  return merged.length > maxBars ? merged.slice(merged.length - maxBars) : merged;
}
