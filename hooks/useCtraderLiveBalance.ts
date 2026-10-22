import { useCallback, useEffect, useState } from 'react';

export interface CtraderLiveBalance {
  balance: number | null;
  equity: number | null;
  /** True when the value came from a successful live fetch this session. */
  isLive: boolean;
  isLoading: boolean;
}

interface CachedCtraderBalance {
  v: 1;
  balance: number;
  equity?: number;
  capturedAt: string;
}

export const CTRADER_BALANCE_MAX_AGE_MS = 7 * 86400000; // 7 days, mirrors bridgeBalance.ts

const cacheKey = (accountId: string | number) => `jfx_ctrader_last_balance_${accountId}`;

export const readCachedCtraderBalance = (
  accountId: string | number | null | undefined,
): { balance: number; equity: number | null; ageMs: number } | null => {
  if (accountId === null || accountId === undefined || accountId === '') return null;
  try {
    const raw = localStorage.getItem(cacheKey(accountId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedCtraderBalance;
    const balance = typeof parsed?.balance === 'number' && Number.isFinite(parsed.balance) ? parsed.balance : null;
    if (balance === null) return null;
    const equity = typeof parsed?.equity === 'number' && Number.isFinite(parsed.equity) ? parsed.equity : null;
    const t = Date.parse((parsed as CachedCtraderBalance)?.capturedAt || '');
    return { balance, equity, ageMs: Number.isFinite(t) ? Date.now() - t : Infinity };
  } catch {
    return null;
  }
};

const writeCachedCtraderBalance = (accountId: string | number, balance: number, equity?: number | null) => {
  try {
    const payload: CachedCtraderBalance = {
      v: 1,
      balance,
      ...(typeof equity === 'number' && Number.isFinite(equity) ? { equity } : {}),
      capturedAt: new Date().toISOString(),
    };
    localStorage.setItem(cacheKey(accountId), JSON.stringify(payload));
  } catch {
    /* storage blocked */
  }
};

/**
 * Live cTrader broker balance for one account, with a timestamped
 * localStorage fallback so the dashboard still matches the broker while
 * offline (same pattern as lastKnownBridgeBalance).
 */
export const useCtraderLiveBalance = (
  accountId: string | number | null | undefined,
): CtraderLiveBalance => {
  const normalized = accountId === undefined || accountId === null || accountId === '' ? null : accountId;
  const [state, setState] = useState<{ balance: number | null; equity: number | null; isLive: boolean }>(() => {
    if (normalized === null) return { balance: null, equity: null, isLive: false };
    const cached = readCachedCtraderBalance(normalized);
    if (cached && cached.ageMs <= CTRADER_BALANCE_MAX_AGE_MS) {
      return { balance: cached.balance, equity: cached.equity, isLive: false };
    }
    return { balance: null, equity: null, isLive: false };
  });
  const [isLoading, setIsLoading] = useState(false);

  const fetchLive = useCallback(async () => {
    if (normalized === null) return;
    let cancelled = false;
    try {
      const svc = await import('../services/ctraderService');
      // Respect an explicit disconnect — never silently re-mint a session.
      try {
        const hasLoggedOut = (svc as { hasLoggedOut?: () => boolean }).hasLoggedOut;
        if (typeof hasLoggedOut === 'function' && hasLoggedOut()) return;
        if (!svc.hasActiveSession || !svc.hasActiveSession()) {
          // No OAuth session in this browser: cached value (if any) stands.
          return;
        }
      } catch {
        /* flag checks are best-effort */
      }
      setIsLoading(true);
      const numericId = Number(normalized);
      if (!Number.isFinite(numericId)) return;
      // Resolve demo/live so the request hits the right socket. A stale
      // guess still works via allowEnvironmentFallback, but prefer exact.
      let isDemo: boolean | undefined;
      try {
        const accs = await svc.getAccounts();
        const match = (accs || []).find((a: any) => Number(a.ctidTraderAccountId) === numericId);
        if (match) isDemo = Boolean((match as any).isDemo);
      } catch {
        /* account list is best-effort; getTrader falls back across envs */
      }
      try {
        const trader = await svc.getTrader(numericId, isDemo ?? true);
        const balance = trader && trader.balance !== undefined ? Number(trader.balance) : NaN;
        const equity = trader && trader.equity !== undefined ? Number(trader.equity) : null;
        if (!Number.isFinite(balance)) return;
        if (cancelled) return;
        writeCachedCtraderBalance(numericId, balance, typeof equity === 'number' && Number.isFinite(equity) ? equity : undefined);
        setState({
          balance,
          equity: typeof equity === 'number' && Number.isFinite(equity) ? equity : null,
          isLive: true,
        });
      } catch {
        /* offline / expired token: keep the cached snapshot */
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    } finally {
      void cancelled;
    }
  }, [normalized]);

  useEffect(() => {
    // Switching accounts must not flash the previous account's balance.
    if (normalized === null) {
      setState({ balance: null, equity: null, isLive: false });
      setIsLoading(false);
      return;
    }
    const cached = readCachedCtraderBalance(normalized);
    setState(
      cached && cached.ageMs <= CTRADER_BALANCE_MAX_AGE_MS
        ? { balance: cached.balance, equity: cached.equity, isLive: false }
        : { balance: null, equity: null, isLive: false },
    );
    void fetchLive();
    const intervalId = window.setInterval(() => void fetchLive(), 60 * 1000);
    const onFocus = () => void fetchLive();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void fetchLive();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [normalized, fetchLive]);

  return { balance: state.balance, equity: state.equity, isLive: state.isLive, isLoading };
};
