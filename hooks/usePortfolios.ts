import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Portfolio, MAX_PORTFOLIOS } from '../types';
import {
  fetchPortfolios,
  insertPortfolio,
  patchPortfolio,
  deletePortfolioRow,
  reassignTradesPortfolio,
  backfillNullTradesToPortfolio,
  reassignTradePortfolioOverlay,
} from '../services/dataService';
import { persistentGetSync, persistentSet, persistentRemove, hydrateUserKeysFromNative } from '../lib/persistentStore';

const cacheKey = (userId: string | null) => `jfx_portfolios_${userId || 'guest'}`;
const activeKey = (userId: string | null) => `jfx_active_portfolio_${userId || 'guest'}`;

// Dual-write helpers: sync mirror + durable native copy so portfolio config
// survives APK restarts that clear the WebView's localStorage.
const storeSet = (key: string, value: string) => {
  try {
    persistentSet(key, value);
  } catch {
    try { localStorage.setItem(key, value); } catch { /* blocked */ }
  }
};
const storeRemove = (key: string) => {
  try {
    persistentRemove(key);
  } catch {
    try { localStorage.removeItem(key); } catch { /* blocked */ }
  }
};
const storeGet = (key: string): string | null => {
  try {
    return persistentGetSync(key);
  } catch {
    try { return localStorage.getItem(key); } catch { return null; }
  }
};

const nowIso = () => new Date().toISOString();

export const generateUUID = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

export const seedDefaultPortfolio = (): Portfolio => ({
  id: 'default',
  name: 'Default Portfolio',
  description: 'Main Trading Journal',
  purpose: 'Journal',
  source: 'manual',
  isDefault: true,
  createdAt: '2020-01-01T00:00:00.000Z', // pinned old so it stays the default after merges
});

const readCache = (userId: string | null): Portfolio[] => {
  try {
    const key = cacheKey(userId);
    const raw = storeGet(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }

    // If user is authenticated and has no cached portfolios yet,
    // check if any custom portfolios were created in 'guest' mode before auth completed.
    if (userId && userId !== 'guest') {
      const guestRaw = storeGet(cacheKey(null));
      if (guestRaw) {
        const guestParsed = JSON.parse(guestRaw);
        if (Array.isArray(guestParsed) && guestParsed.length > 0) {
          const hasCustom = guestParsed.some(p => !p.isArchived && p.id !== 'default');
          if (hasCustom) {
            storeSet(key, guestRaw);
            storeRemove(cacheKey(null));
            return guestParsed;
          }
        }
      }
    }
    return [];
  } catch {
    return [];
  }
};

const readActive = (userId: string | null): string | null => {
  try {
    const key = activeKey(userId);
    const val = storeGet(key);
    if (val) return val;

    if (userId && userId !== 'guest') {
      const guestVal = storeGet(activeKey(null));
      if (guestVal) {
        storeSet(key, guestVal);
        storeRemove(activeKey(null));
        return guestVal;
      }
    }
    return null;
  } catch {
    return null;
  }
};

/** Oldest non-archived portfolio is the Default (can't be deleted, owns legacy trades). */
export const resolveDefaultId = (list: Portfolio[]): string | null => {
  const live = list.filter(p => !p.isArchived);
  if (!live.length) return null;
  const flagged = live.find(p => p.isDefault);
  if (flagged) return flagged.id;
  return [...live].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0].id;
};

export const usePortfolios = (userId: string | null) => {
  const [portfolios, setPortfolios] = useState<Portfolio[]>(() => {
    const cached = readCache(userId);
    return cached.length ? cached : [seedDefaultPortfolio()];
  });
  const [activeId, setActiveIdState] = useState<string | null>(() => readActive(userId));
  const [isLoading, setIsLoading] = useState(false);
  const userRef = useRef<string | null>(userId);
  const syncedOnce = useRef(false);

  // Persist cache + active selection per user safely.
  // CRITICAL: Only write if userRef.current === userId.
  // When userId changes during auth resolution, the component must NOT overwrite
  // the new user's cache with the old user's un-updated state!
  useEffect(() => {
    if (userRef.current !== userId) return;
    try {
      storeSet(cacheKey(userId), JSON.stringify(portfolios));
    } catch { /* storage blocked */ }
  }, [portfolios, userId]);

  useEffect(() => {
    if (userRef.current !== userId) return;
    try {
      if (activeId) storeSet(activeKey(userId), activeId);
      else storeRemove(activeKey(userId));
    } catch { /* storage blocked */ }
  }, [activeId, userId]);

  // Native boot: hydrate durable copies into the sync mirror.
  useEffect(() => {
    void hydrateUserKeysFromNative(userId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncWithServer = useCallback(async (uid: string | null, attempt = 0) => {
    if (!uid) return;
    // Allow retry: only skip if we've already successfully synced.
    if (syncedOnce.current) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    setIsLoading(true);
    try {
      const server = await fetchPortfolios(uid);
      if (!server || !server.length) {
        // First run: provision Default on the server (or adopt local customs).
        const local = readCache(uid).filter(p => !p.isArchived && p.id !== 'default');
        let list: Portfolio[];
        if (local.length) {
          const pushed: Portfolio[] = [];
          for (const p of local) {
            try {
              pushed.push(await insertPortfolio(uid, { ...p, isDefault: false }));
            } catch {
              pushed.push(p); // stays local-only until next sync
            }
          }
          try {
            const def = await insertPortfolio(uid, { ...seedDefaultPortfolio(), id: undefined, isDefault: true });
            list = [def, ...pushed];
          } catch {
            list = [seedDefaultPortfolio(), ...pushed];
          }
        } else {
          try {
            const def = await insertPortfolio(uid, { ...seedDefaultPortfolio(), id: undefined, isDefault: true });
            list = [def];
          } catch {
            list = [seedDefaultPortfolio()];
          }
        }
        setPortfolios(list);
        try { storeSet(cacheKey(uid), JSON.stringify(list)); } catch {}
        const defId = resolveDefaultId(list);
        if (defId) {
          try { await backfillNullTradesToPortfolio(uid, defId); } catch {}
          setActiveIdState(prev => (prev && (prev === 'all' || list.some(p => p.id === prev)) ? prev : defId));
        }
      } else {
        // Server wins; keep local-only rows (created offline) alongside.
        const serverIds = new Set(server.map(p => p.id));
        const localOnly = readCache(uid).filter(p => !serverIds.has(p.id) && !p.isArchived);
        // Flush offline-created rows to the server (client UUIDs stay stable).
        const flushed: Portfolio[] = [];
        for (const p of localOnly) {
          if (p.id === 'default') continue; // seed superseded by real Default
          try {
            flushed.push(await insertPortfolio(uid, p));
          } catch {
            flushed.push(p);
          }
        }
        const merged = [...server, ...flushed];
        // Collapse duplicate defaults: if the seed survived and server has a
        // real default, drop the seed.
        const realDefault = merged.find(p => p.id !== 'default' && p.isDefault) || merged.find(p => p.id !== 'default');
        const finalList = realDefault ? merged.filter(p => p.id !== 'default') : merged;
        setPortfolios(finalList);
        try { storeSet(cacheKey(uid), JSON.stringify(finalList)); } catch {}
        const defId = resolveDefaultId(finalList);
        if (defId) {
          try { await backfillNullTradesToPortfolio(uid, defId); } catch {}
          setActiveIdState(prev => (prev && (prev === 'all' || finalList.some(p => p.id === prev)) ? prev : defId));
        }
      }
      // Mark sync as successful — prevents repeated fetches.
      syncedOnce.current = true;
    } catch (syncErr) {
      // Transient failure (network, auth timing, table missing): retry once
      // after a short delay so portfolios aren't permanently lost after reinstall.
      console.warn('[usePortfolios] syncWithServer failed (attempt', attempt, '):', syncErr);
      if (attempt < 2) {
        const delay = (attempt + 1) * 3000; // 3s, 6s
        setTimeout(() => void syncWithServer(uid, attempt + 1), delay);
      } else {
        console.error('[usePortfolios] syncWithServer gave up after', attempt + 1, 'attempts');
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Reload when the account changes (login / logout / switch).
  useEffect(() => {
    if (userRef.current === userId && syncedOnce.current) return;
    userRef.current = userId;
    syncedOnce.current = false;
    const cached = readCache(userId);
    const resolvedPortfolios = cached.length ? cached : [seedDefaultPortfolio()];
    setPortfolios(resolvedPortfolios);
    const savedActive = readActive(userId);
    const resolvedDefault = resolveDefaultId(resolvedPortfolios);
    setActiveIdState(savedActive || resolvedDefault);
    setIsLoading(false);
    void syncWithServer(userId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const defaultId = useMemo(() => resolveDefaultId(portfolios), [portfolios]);
  const livePortfolios = useMemo(() => portfolios.filter(p => !p.isArchived), [portfolios]);
  const canAdd = livePortfolios.length < MAX_PORTFOLIOS;
  const activePortfolio: Portfolio | null = useMemo(
    () => {
      if (activeId === 'all') {
        return {
          id: 'all',
          name: 'All Portfolios',
          description: 'Combined view of all trades across portfolios',
          source: 'manual',
          isDefault: false,
          createdAt: '2020-01-01T00:00:00.000Z',
        };
      }
      return portfolios.find(p => p.id === activeId && !p.isArchived)
        || portfolios.find(p => p.id === defaultId)
        || livePortfolios[0]
        || null;
    },
    [portfolios, activeId, defaultId, livePortfolios]
  );
  const activePortfolioId = activePortfolio?.id || null;

  const setActiveId = useCallback((id: string) => {
    setActiveIdState(id);
    try {
      if (id) storeSet(activeKey(userId), id);
      else storeRemove(activeKey(userId));
    } catch {}
  }, [userId]);

  const addPortfolio = useCallback(async (input: {
    name: string;
    description?: string;
    purpose?: Portfolio['purpose'];
    source?: Portfolio['source'];
    startingBalance?: number;
    currency?: string;
  }): Promise<Portfolio> => {
    const name = (input.name || '').trim().slice(0, 80);
    if (!name) {
      const err = new Error('Name your portfolio first.');
      (err as any).code = 'PORTFOLIO_NAME_REQUIRED';
      throw err;
    }
    if (!canAdd) {
      const err = new Error(`Portfolio slots full (${MAX_PORTFOLIOS}/${MAX_PORTFOLIOS}). Archive one to make room.`);
      (err as any).code = 'PORTFOLIO_LIMIT';
      throw err;
    }
    const draft: Portfolio = {
      id: generateUUID(),
      name,
      description: (input.description || '').trim().slice(0, 280) || undefined,
      purpose: input.purpose || 'Journal',
      source: input.source || 'manual',
      startingBalance: input.startingBalance,
      currency: input.currency,
      createdAt: nowIso(),
    };

    // Synchronously write to localStorage immediately so data is never lost if route transitions or app restarts
    setPortfolios(prev => {
      const next = [...prev, draft];
      try { storeSet(cacheKey(userId), JSON.stringify(next)); } catch {}
      return next;
    });
    setActiveIdState(draft.id);
    try { storeSet(activeKey(userId), draft.id); } catch {}

    if (userId) {
      try {
        const saved = await insertPortfolio(userId, draft);
        if (saved && saved.id) {
          setPortfolios(prev => {
            const next = prev.map(p => (p.id === draft.id ? { ...saved, createdAt: draft.createdAt } : p));
            try { storeSet(cacheKey(userId), JSON.stringify(next)); } catch {}
            return next;
          });
          setActiveIdState(prev => {
            const nextId = (prev === draft.id ? saved.id : prev);
            try { if (nextId) storeSet(activeKey(userId), nextId); } catch {}
            return nextId;
          });
          return { ...saved, createdAt: draft.createdAt };
        }
      } catch (insertErr) {
        // Server insert failed — portfolio stays local-only for now.
        // Reset syncedOnce so next syncWithServer attempt will flush it.
        console.warn('[usePortfolios] addPortfolio server insert failed, will retry on next sync:', insertErr);
        syncedOnce.current = false;
      }
    }
    return draft;
  }, [canAdd, userId]);

  const updatePortfolio = useCallback(async (id: string, patch: Partial<Portfolio>) => {
    const { id: _drop, isDefault: _keep, createdAt: _pin, ...safe } = patch;
    setPortfolios(prev => {
      const next = prev.map(p => (p.id === id ? { ...p, ...safe, updatedAt: nowIso() } : p));
      try { storeSet(cacheKey(userId), JSON.stringify(next)); } catch {}
      return next;
    });
    if (userId && id !== 'default') {
      try {
        await patchPortfolio(id, safe);
      } catch { /* local-only for now */ }
    }
  }, [userId]);

  /**
   * Delete a portfolio. Trades are reassigned to Default first (server +
   * caller remaps local trade state via the returned ids).
   */
  const removePortfolio = useCallback(async (id: string): Promise<{ from: string; to: string | null }> => {
    const target = portfolios.find(p => p.id === id);
    if (!target || target.isDefault || id === defaultId) {
      const err = new Error('The Default portfolio cannot be deleted.');
      (err as any).code = 'PORTFOLIO_DEFAULT_LOCKED';
      throw err;
    }
    const to = defaultId;
    if (userId) {
      try {
        if (to) await reassignTradesPortfolio(userId, id, to);
        if (id !== 'default') await deletePortfolioRow(id);
      } catch { /* local state still updates; server reconciles next sync */ }
    }
    if (userId && to) {
      reassignTradePortfolioOverlay(userId, id, to);
    }
    setPortfolios(prev => {
      const next = prev.filter(p => p.id !== id);
      try { storeSet(cacheKey(userId), JSON.stringify(next)); } catch {}
      return next;
    });
    setActiveIdState(prev => {
      const nextId = (prev === id ? to : prev);
      try {
        if (nextId) storeSet(activeKey(userId), nextId);
        else storeRemove(activeKey(userId));
      } catch {}
      return nextId;
    });
    return { from: id, to };
  }, [portfolios, defaultId, userId]);

  /** True when an external account is already linked to another portfolio. */
  const findLinkCollision = useCallback((provider: string, externalAccountId: string, excludeId?: string) => {
    const needle = `${provider}:${externalAccountId}`.toLowerCase();
    return portfolios.find(p =>
      p.id !== excludeId &&
      !p.isArchived &&
      (p.accounts || []).some(a =>
        `${a.provider}:${a.externalAccountId || ''}`.toLowerCase() === needle
      )
    ) || null;
  }, [portfolios]);

  return {
    portfolios: livePortfolios,
    allPortfolios: portfolios,
    activePortfolio,
    activePortfolioId,
    defaultId,
    canAdd,
    maxPortfolios: MAX_PORTFOLIOS,
    isLoading,
    setActiveId,
    addPortfolio,
    updatePortfolio,
    removePortfolio,
    findLinkCollision,
    refresh: () => { syncedOnce.current = false; return syncWithServer(userId); },
  };
};
