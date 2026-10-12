import { useEffect, useState } from 'react';

export interface CtraderQuoteSymbol {
  symbolId: number;
  symbolName: string;
  digits?: number;
  description?: string;
}

interface UseCtraderSymbolsResult {
  isDemo: boolean;
  symbols: CtraderQuoteSymbol[];
  isLoading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Shared cTrader symbol loading: resolves demo/live from the account list,
 * then loads the account's symbols. Used by both the Quotes picker and the
 * Trade (market execution) tab so they stay in sync.
 */
export const useCtraderSymbols = (ctidAccountId?: string | null): UseCtraderSymbolsResult => {
  const numericAccountId = Number(ctidAccountId);
  const validAccountId = Number.isFinite(numericAccountId) && numericAccountId > 0 ? numericAccountId : null;

  const [isDemo, setIsDemo] = useState(true);
  const [symbols, setSymbols] = useState<CtraderQuoteSymbol[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadSignal, setReloadSignal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (validAccountId === null) {
      setSymbols([]);
      setError(null);
      setIsLoading(false);
      return;
    }
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const svc = await import('../services/ctraderService');
        let demo = true;
        try {
          const accs = await svc.getAccounts();
          const match = (accs || []).find((a: any) => Number(a.ctidTraderAccountId) === validAccountId);
          if (match) demo = Boolean((match as any).isDemo);
        } catch {
          /* account list best-effort; default to demo socket */
        }
        if (cancelled) return;
        setIsDemo(demo);
        const list = await svc.getCachedSymbolsList(validAccountId, demo).catch(() => [] as any[]);
        if (cancelled) return;
        const normalized: CtraderQuoteSymbol[] = (list || [])
          .map((s: any) => ({
            symbolId: Number(s.symbolId ?? s.id),
            symbolName: String(s.symbolName ?? s.name ?? `ID ${s.symbolId ?? s.id}`),
            digits: s.digits !== undefined ? Number(s.digits) : undefined,
            description: s.description ? String(s.description) : undefined,
          }))
          .filter((s: CtraderQuoteSymbol) => Number.isFinite(s.symbolId) && s.symbolName)
          .sort((a: CtraderQuoteSymbol, b: CtraderQuoteSymbol) => a.symbolName.localeCompare(b.symbolName));
        setSymbols(normalized);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Could not load symbols. Reconnect cTrader and retry.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [validAccountId, reloadSignal]);

  return {
    isDemo,
    symbols,
    isLoading,
    error,
    reload: () => setReloadSignal((s) => s + 1),
  };
};
