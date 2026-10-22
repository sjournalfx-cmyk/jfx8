/**
 * Shared cTrader spot-price bus with reference-counted broker subscriptions.
 *
 * Problem it fixes: every consumer used to subscribe/unsubscribe directly.
 * When one screen unmounted (e.g. Quotes replaced by the Chart), its cleanup
 * sent UNSUBSCRIBE for symbols another mounted screen still needed — the
 * broker stops the feed connection-wide and the remaining screen goes dark
 * with no error. With the bus, the broker subscription lives until the LAST
 * holder releases it, and duplicate SUBSCRIBEs are coalesced.
 */
export interface BusTick {
  /** Raw wire values — usually scaled ints, occasionally ''/null on gaps. */
  bid?: number | string | null;
  ask?: number | string | null;
}

export type BusListener = (tick: BusTick) => void;

interface SpotBackend {
  subscribe: (accountId: number, symbolIds: number[], isDemo: boolean) => Promise<unknown>;
  unsubscribe: (accountId: number, symbolIds: number[], isDemo: boolean) => Promise<unknown>;
  addListener: (fn: (payloadType: number, payload: any, wsIsDemo: boolean) => void) => () => void;
  spotEvent: number;
  /** True when a subscribe failure means "wrong environment, retry other". */
  isCantRoute?: (e: any) => boolean;
}

let backendPromise: Promise<SpotBackend> | null = null;
let resolvedBackend: SpotBackend | null = null;
let globalDetach: (() => void) | null = null;

function defaultBackend(): Promise<SpotBackend> {
  if (!backendPromise) {
    backendPromise = import('../services/ctraderService').then((svc) => ({
      // The web ctraderService takes ONE symbolId per call (the mobile build
      // takes an array). Passing the array straight through put an array into
      // the subscription Set, so web live prices never matched a symbol.
      subscribe: async (a, ids, d) => {
        for (const id of ids) await svc.subscribeToSpots(a, id, d);
      },
      unsubscribe: async (a, ids, d) => {
        for (const id of ids) await svc.unsubscribeFromSpots(a, id, d);
      },
      addListener: (fn) => svc.addCtraderListener(fn),
      spotEvent: svc.PT.SPOT_EVENT,
      // isCantRouteRequestError only exists in the mobile service; calling it
      // here threw a TypeError inside the catch and skipped the env fallback.
      isCantRoute: (e) => {
        const fn = (svc as { isCantRouteRequestError?: (err: unknown) => boolean }).isCantRouteRequestError;
        return typeof fn === 'function'
          ? fn(e)
          : String((e as any)?.message || e).includes('CANT_ROUTE_REQUEST');
      },
    }));
  }
  return backendPromise;
}

// Test seam: inject a fake backend (resets all bus state).
export function __configureSpotBackendForTests(
  backend: SpotBackend | null
): void {
  backendPromise = backend ? Promise.resolve(backend) : null;
  resolvedBackend = backend;
  globalDetach = null;
  refCounts.clear();
  listeners.clear();
  meta.clear();
}

const refKey = (accountId: number, isDemo: boolean, symbolId: number): string =>
  `${accountId}|${isDemo ? 'd' : 'l'}|${symbolId}`;

const refCounts = new Map<string, number>();
const listeners = new Map<string, Set<BusListener>>();
// actualDemo: env the broker subscription really lives on. Normally ===
// isDemo; set to the opposite env when the first SUBSCRIBE hits
// CANT_ROUTE_REQUEST and transparently falls back (history calls already
// do this via allowEnvironmentFallback — without it the live tail would
// sit frozen while candles load fine).
const meta = new Map<string, { isDemo: boolean; symbolId: number; actualDemo?: boolean }>();

async function ensureGlobalListener(be: SpotBackend): Promise<void> {
  if (globalDetach) return;
  globalDetach = be.addListener((payloadType, payload, wsIsDemo) => {
    if (payloadType !== be.spotEvent) return;
    const sid = Number(payload?.symbolId);
    if (!Number.isFinite(sid)) return;
    const tick: BusTick = { bid: payload?.bid, ask: payload?.ask };
    for (const [k, set] of listeners) {
      const m = meta.get(k);
      if (!m || m.symbolId !== sid) continue;
      if ((m.actualDemo ?? m.isDemo) !== wsIsDemo) continue;
      set.forEach((fn) => {
        try {
          fn(tick);
        } catch {
          /* a bad consumer must not break the bus */
        }
      });
    }
  });
}

export interface SpotHandle {
  /** Detach this listener; broker unsubscribes when the last holder leaves. */
  release: () => void;
}

/**
 * Hold a spot feed for one (account, env, symbol). The broker SUBSCRIBE is
 * sent once for the first holder and UNSUBSCRIBE once for the last release.
 * The returned release is idempotent and safe to call after unmount races.
 */
export async function acquireSpot(
  accountId: number,
  isDemo: boolean,
  symbolId: number,
  listener: BusListener
): Promise<SpotHandle> {
  const k = refKey(accountId, isDemo, symbolId);
  let set = listeners.get(k);
  if (!set) {
    set = new Set();
    listeners.set(k, set);
    meta.set(k, { isDemo, symbolId });
  }
  set.add(listener);
  const refs = (refCounts.get(k) ?? 0) + 1;
  refCounts.set(k, refs);

  const be = await defaultBackend();
  resolvedBackend = be;
  await ensureGlobalListener(be);
  if (refs === 1) {
    // First holder pays the SUBSCRIBE; failures are swallowed — ticks may
    // already flow from an overlapping raw subscription elsewhere.
    try {
      await be.subscribe(accountId, [symbolId], isDemo);
    } catch (e) {
      // Wrong environment (account lives on the other host): retry there
      // and remember it so event delivery + release use the real env.
      const cantRoute = be.isCantRoute
        ? be.isCantRoute(e)
        : String((e as any)?.message || e).includes('CANT_ROUTE_REQUEST');
      if (cantRoute) {
        try {
          await be.subscribe(accountId, [symbolId], !isDemo);
          meta.set(k, { isDemo, symbolId, actualDemo: !isDemo });
        } catch {
          /* offline: history stays, stale badge shows */
        }
      }
    }
  }

  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      set!.delete(listener);
      const left = (refCounts.get(k) ?? 1) - 1;
      if (left <= 0) {
        refCounts.delete(k);
        listeners.delete(k);
        // Read the real env BEFORE dropping meta so the UNSUBSCRIBE
        // targets the socket the subscription actually lives on.
        const env = meta.get(k)?.actualDemo ?? isDemo;
        meta.delete(k);
        // Unsubscribe synchronously off the cached backend so unmount
        // cleanups can't strand (or resurrect) broker subscriptions.
        const be = resolvedBackend;
        if (be) {
          void be.unsubscribe(accountId, [symbolId], env).catch(() => {});
        } else {
          void defaultBackend()
            .then((b) => b.unsubscribe(accountId, [symbolId], env).catch(() => {}))
            .catch(() => {});
        }
      } else {
        refCounts.set(k, left);
      }
    },
  };
}
