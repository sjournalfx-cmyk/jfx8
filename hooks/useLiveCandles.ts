import { useCallback, useEffect, useRef, useState } from 'react';
import type { Candle } from '../types';
import { applyTick, LIVE_TF_SECONDS, MAX_LIVE_BARS, mergeHistory } from '../lib/liveCandles';

export interface LiveCandlesState {
  bars: Candle[];
  isLoading: boolean;
  error: string | null;
  /** Local ms of the last applied spot tick (0 = none yet). */
  lastTickAt: number;
  /** True when no tick arrived within the freshness window. */
  isStale: boolean;
  reload: () => void;
}

const HISTORY_COUNT = 500;
const FLUSH_MS = 250;
const TOPUP_INTERVAL_MS = 30_000;

/** No tick for longer than this (per timeframe) counts as stale/delayed. */
const staleAfterMs = (timeframe: string): number => {
  const tfSec = LIVE_TF_SECONDS[String(timeframe || 'H1').toUpperCase()] || 3600;
  return Math.min(Math.max(tfSec, 30) * 2 * 1000, 5 * 60 * 1000);
};

/**
 * Live candles for one symbol: trendbar history over the connected browser
 * WS + a spot-driven live tail (mid price, bucketed on local arrival time —
 * the broker sends no tick timestamps). Throttled emissions (~4fps) keep
 * the canvas smooth on sub-second majors.
 */
export const useLiveCandles = (
  ctidAccountId: string | number | null | undefined,
  isDemo: boolean,
  symbolId: number | null,
  symbolName: string,
  digits: number,
  timeframe: string
): LiveCandlesState => {
  const numericAccountId =
    ctidAccountId === null || ctidAccountId === undefined || ctidAccountId === ''
      ? null
      : Number(ctidAccountId);
  const validAccountId =
    numericAccountId !== null && Number.isFinite(numericAccountId) && numericAccountId > 0
      ? numericAccountId
      : null;
  const validSymbolId =
    symbolId !== null && Number.isFinite(Number(symbolId)) ? Number(symbolId) : null;

  const [bars, setBars] = useState<Candle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastTickAt, setLastTickAt] = useState(0);
  const [staleTick, setStaleTick] = useState(0);

  const barsRef = useRef<Candle[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadSeq = useRef(0);
  const subKey = `${validAccountId ?? ''}|${isDemo ? 'd' : 'l'}|${validSymbolId ?? ''}|${timeframe}`;

  const flush = useCallback(() => {
    flushTimer.current = null;
    setBars(barsRef.current);
    setLastTickAt(Date.now());
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimer.current !== null) return;
    flushTimer.current = setTimeout(flush, FLUSH_MS);
  }, [flush]);

  const loadHistory = useCallback(async () => {
    const seq = ++loadSeq.current;
    if (validAccountId === null || validSymbolId === null) {
      barsRef.current = [];
      setBars([]);
      setError('No cTrader account selected.');
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const svc = await import('../services/ctraderService');
      if (loadSeq.current !== seq) return;
      const data = await svc.fetchCtraderCandles(
        validAccountId, symbolName, timeframe, HISTORY_COUNT, isDemo
      );
      if (loadSeq.current !== seq) return;
      const clean = Array.isArray(data) ? data : [];
      barsRef.current = clean.slice(-MAX_LIVE_BARS);
      setBars(barsRef.current);
      if (clean.length === 0) setError('No candles returned for this symbol.');
    } catch (e: any) {
      if (loadSeq.current !== seq) return;
      setError(e?.message || 'Failed to load chart.');
    } finally {
      if (loadSeq.current === seq) setIsLoading(false);
    }
  }, [validAccountId, validSymbolId, symbolName, timeframe, isDemo]);

  // History (re)load on account/symbol/timeframe/env change.
  useEffect(() => {
    setLastTickAt(0);
    void loadHistory();
  }, [loadHistory]);

  // Spot tail: hold a bus feed, fold ticks, throttled flush. The bus is
  // reference-counted — Quotes unmounting (chart replaces it) no longer
  // kills this feed via a competing UNSUBSCRIBE.
  useEffect(() => {
    if (validAccountId === null || validSymbolId === null) return;
    let alive = true;
    const releases: Array<() => void> = [];
    const sid = validSymbolId;

    void (async () => {
      try {
        const { acquireSpot } = await import('../lib/spotBus');
        if (!alive) return;
        const handle = await acquireSpot(validAccountId, isDemo, sid, (tick) => {
          if (!alive) return;
          const next = applyTick(
            barsRef.current,
            { bid: tick.bid, ask: tick.ask },
            Date.now(),
            timeframe,
            digits
          );
          if (next !== barsRef.current) {
            barsRef.current = next;
            scheduleFlush();
          }
        });
        if (!alive) handle.release();
        else releases.push(handle.release);
      } catch {
        /* offline: history stays, stale badge shows */
      }
    })();

    return () => {
      alive = false;
      if (flushTimer.current !== null) {
        clearTimeout(flushTimer.current);
        flushTimer.current = null;
      }
      releases.splice(0).forEach((release) => release());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subKey]);

  // Gap top-up: when ticks are sparse the newest bar goes stale — refetch
  // the tail and merge (dedupe by time). Also drives the stale indicator.
  useEffect(() => {
    if (validAccountId === null) return;
    const timer = setInterval(() => {
      setStaleTick(Date.now());
      const last = barsRef.current[barsRef.current.length - 1];
      if (!last) return;
      const tfSec = LIVE_TF_SECONDS[String(timeframe || 'H1').toUpperCase()] || 3600;
      if (Date.now() / 1000 - Number(last.time) <= tfSec) return;
      void (async () => {
        try {
          const svc = await import('../services/ctraderService');
          const tail = await svc.fetchCtraderCandles(
            validAccountId, symbolName, timeframe, HISTORY_COUNT, isDemo,
            1, Number(last.time) * 1000
          );
          if (Array.isArray(tail) && tail.length > 0) {
            barsRef.current = mergeHistory(barsRef.current, tail);
            setBars(barsRef.current);
          }
        } catch {
          /* keep existing bars; retry next interval */
        }
      })();
    }, TOPUP_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [validAccountId, symbolName, timeframe, isDemo]);

  // Re-evaluate staleness on a slow cadence so the badge flips without ticks.
  useEffect(() => {
    const timer = setInterval(() => setStaleTick(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);

  void staleTick;
  // No ticks yet (history just loaded) is not stale — staleness only
  // applies once the tail has ticked at least once.
  const isStale = lastTickAt !== 0 && Date.now() - lastTickAt > staleAfterMs(timeframe);

  return { bars, isLoading, error, lastTickAt, isStale, reload: loadHistory };
};
