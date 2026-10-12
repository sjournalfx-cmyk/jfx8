import { useEffect, useState } from 'react';

export interface CtraderSpotTick {
  /** Raw wire values (scaled integers — divide by 10^digits to display). */
  bid?: number;
  /** Raw wire values (scaled integers — divide by 10^digits to display). */
  ask?: number;
  /** Tick direction off ask: 'up' | 'down', null until the second tick. */
  dir: 'up' | 'down' | null;
  /** Session-observed extremes (raw wire values) for the MT5-style L/H line. */
  lo?: number;
  hi?: number;
  time: number;
}

export type CtraderSpotsMap = Record<string, CtraderSpotTick>;

/**
 * Live spot prices for a batch of symbols. Subscribes to the given ids,
 * tracks bid/ask + tick direction per symbol, and unsubscribes the previous
 * set whenever ids/account/env change or on unmount.
 */
export const useCtraderSpots = (
  ctidAccountId: string | number | null | undefined,
  isDemo: boolean,
  symbolIds: number[]
): CtraderSpotsMap => {
  const numericAccountId =
    ctidAccountId === null || ctidAccountId === undefined || ctidAccountId === ''
      ? null
      : Number(ctidAccountId);
  const validAccountId =
    numericAccountId !== null && Number.isFinite(numericAccountId) && numericAccountId > 0
      ? numericAccountId
      : null;

  const [ticks, setTicks] = useState<CtraderSpotsMap>({});

  // Stable key for the id set so the effect only reruns on real changes.
  const idsKey = [...symbolIds]
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b)
    .join(',');

  useEffect(() => {
    if (validAccountId === null || idsKey === '') {
      setTicks({});
      return;
    }
    const ids = idsKey.split(',').map(Number);
    let alive = true;
    const releases: Array<() => void> = [];

    // Reference-counted bus feeds: co-mounted screens (chart, positions)
    // share one broker subscription per symbol instead of racing
    // SUBSCRIBE/UNSUBSCRIBE against each other on mount/unmount.
    void (async () => {
      try {
        const { acquireSpot } = await import('../lib/spotBus');
        if (!alive) return;
        for (const id of ids) {
          const key = String(id);
          const handle = await acquireSpot(validAccountId, isDemo, id, ({ bid: rawBid, ask: rawAsk }) => {
            if (!alive) return;
            const bid = rawBid !== undefined && rawBid !== null && rawBid !== '' ? Number(rawBid) : NaN;
            const ask = rawAsk !== undefined && rawAsk !== null && rawAsk !== '' ? Number(rawAsk) : NaN;
            setTicks((prev) => {
              const prevTick = prev[key];
              const prevAsk = prevTick?.ask;
              let dir = prevTick?.dir ?? null;
              if (Number.isFinite(ask) && Number.isFinite(prevAsk) && ask !== prevAsk) {
                dir = ask > (prevAsk as number) ? 'up' : 'down';
              }
              // Session L/H off bid (both raw wire values).
              const prevLo = prevTick?.lo;
              const prevHi = prevTick?.hi;
              const lo = Number.isFinite(bid) ? (prevLo === undefined ? bid : Math.min(prevLo, bid)) : prevLo;
              const hi = Number.isFinite(bid) ? (prevHi === undefined ? bid : Math.max(prevHi, bid)) : prevHi;
              return {
                ...prev,
                [key]: {
                  bid: Number.isFinite(bid) ? bid : prevTick?.bid,
                  ask: Number.isFinite(ask) ? ask : prevTick?.ask,
                  dir,
                  lo,
                  hi,
                  time: Date.now(),
                },
              };
            });
          });
          if (!alive) handle.release();
          else releases.push(handle.release);
        }
      } catch {
        /* offline / expired session: rows keep placeholders */
      }
    })();

    setTicks({});

    return () => {
      alive = false;
      releases.splice(0).forEach((release) => release());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validAccountId, isDemo, idsKey]);

  return ticks;
};
