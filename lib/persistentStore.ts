/**
 * Key/value store for the web bundle.
 *
 * Why this exists: the APK version (jfx-mobile/lib/persistentStore.ts) dual-writes
 * every durable key to Capacitor Preferences because the Android/iOS WebView's
 * `window.localStorage` is transient — the OS can reclaim it, and WebView origin
 * changes historically wiped it on every force-close (Capacitor #636). That is
 * how cTrader imports "vanished" after an APK restart: trades lived in Supabase
 * but their portfolio assignment lived only in `jfx_trade_portfolios_<userId>`.
 *
 * On the web, none of that applies. localStorage IS the durable store, and this
 * repo has zero `@capacitor/*` dependencies by design — the web bundle must stay
 * dependency-free of native plugins (see the sibling note in lib/capacitor.ts).
 *
 * So this is the web twin: the SAME export surface as the native module, backed
 * by localStorage + an in-memory cache so per-row overlay lookups never hit
 * disk. Every `hydrate*` helper is an intentional no-op here — on web there is
 * no second durable copy to merge in, so hydration would be a redundant scan of
 * localStorage that we already read synchronously.
 *
 * Keeping the surface identical is what lets hooks/usePortfolios.ts, the trade
 * portfolio overlay, and the offline queue be byte-identical between the two
 * repos instead of drifting again.
 */

const memCache = new Map<string, string | null>();

export const persistentGetSync = (key: string): string | null => {
  if (memCache.has(key)) return memCache.get(key) ?? null;
  try {
    if (typeof window === 'undefined') return null;
    const v = window.localStorage.getItem(key);
    memCache.set(key, v);
    return v;
  } catch {
    return null;
  }
};

export const persistentSet = (key: string, value: string): void => {
  memCache.set(key, value);
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
  } catch {
    /* quota exceeded or storage blocked (private mode) — nothing else to do */
  }
};

export const persistentRemove = (key: string): void => {
  memCache.delete(key);
  try {
    if (typeof window !== 'undefined') window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
};

/**
 * No-op on web: there is no durable secondary copy to merge into the mirror.
 * Reads are already synchronous against localStorage via memCache, so hydration
 * would add latency without restoring anything.
 */
export const hydrateKeysFromNative = async (_keys: string[]): Promise<void> => {};

/** No-op on web: see hydrateKeysFromNative. */
export const listNativeKeys = async (): Promise<string[]> => [];

/**
 * Hydrate every known durable key for a user: portfolio list, active id,
 * trade-portfolio overlay, offline queue, EA session + bridge balance.
 *
 * On the APK this copies the Capacitor Preferences copy into localStorage
 * before the first Supabase fetch. On web the localStorage mirror IS the
 * source of truth, so this only warms the in-memory cache and then returns —
 * which keeps the boot ordering in App.tsx identical across both repos.
 */
export const hydrateUserKeysFromNative = async (userId: string | null): Promise<void> => {
  const uid = userId || 'guest';
  const durableKeys = [
    `jfx_trade_portfolios_${uid}`,
    `jfx_portfolios_${uid}`,
    `jfx_active_portfolio_${uid}`,
    `jfx_offline_trades_${uid}`,
    `jfx_ea_session_${uid}`,
    `jfx_last_bridge_balance_${uid}`,
  ];
  for (const key of durableKeys) {
    try {
      if (typeof window === 'undefined') break;
      if (window.localStorage.getItem(key) !== null) {
        memCache.set(key, window.localStorage.getItem(key));
      }
    } catch {
      /* per-key failure must not block boot */
    }
  }
};

/** Test seam — clears the in-memory mirror so localStorage is re-read. */
export const __resetPersistentStoreCache = (): void => {
  memCache.clear();
};