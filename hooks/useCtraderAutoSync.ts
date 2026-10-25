import { useEffect, useMemo, useRef } from 'react';
import { Portfolio, Trade } from '../types';
import { dataService } from '../services/dataService';
import { buildCtraderDealTrade } from '../lib/ctraderDealTrade';
import { persistentGetSync, persistentSet } from '../lib/persistentStore';

export const CTRADER_AUTOSYNC_KEY = 'jfx_ctrader_autosync';
export const CTRADER_AUTOSYNC_EVENT = 'jfx-ctrader-autosync-changed';

const FIRST_RUN_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const OVERLAP_MS = 2 * 60 * 1000;

const scopeKey = (accountId: string | number, portfolioId: string) => `${accountId}_${portfolioId || 'default'}`;
const savedDealsKey = (accountId: string | number, portfolioId: string) =>
  `jfx_ctrader_saved_deals_${scopeKey(accountId, portfolioId)}`;
const lastSyncKey = (accountId: string | number, portfolioId: string) =>
  `jfx_ctrader_autosync_at_${scopeKey(accountId, portfolioId)}`;

export const isCtraderAutoSyncEnabled = (): boolean => {
  try {
    return localStorage.getItem(CTRADER_AUTOSYNC_KEY) !== 'off';
  } catch {
    return true;
  }
};

export const setCtraderAutoSyncEnabled = (enabled: boolean): void => {
  try {
    localStorage.setItem(CTRADER_AUTOSYNC_KEY, enabled ? 'on' : 'off');
  } catch {
    /* storage blocked */
  }
  try {
    window.dispatchEvent(new Event(CTRADER_AUTOSYNC_EVENT));
  } catch {
    /* no window (tests/SSR) */
  }
};

const readSavedDealIds = (accountId: string | number, portfolioId: string): Set<number> => {
  try {
    const raw = persistentGetSync(savedDealsKey(accountId, portfolioId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : []);
  } catch {
    return new Set();
  }
};

const writeSavedDealIds = (accountId: string | number, portfolioId: string, ids: number[]): void => {
  try {
    const merged = readSavedDealIds(accountId, portfolioId);
    ids.forEach((id) => merged.add(id));
    persistentSet(savedDealsKey(accountId, portfolioId), JSON.stringify(Array.from(merged).slice(-5000)));
  } catch {
    /* ignore */
  }
};

interface CtraderPortfolioLink {
  portfolioId: string;
  portfolioName: string;
  accountId: string;
}

export interface UseCtraderAutoSyncOptions {
  userId: string | null;
  enabled: boolean;
  portfolios: Portfolio[];
  trades?: Trade[];
  onTradesAddedBatch?: (trades: Trade[]) => void;
  onSynced?: (count: number, portfolioName: string) => void;
  intervalMs?: number;
  firstRunLookbackMs?: number;
}

/**
 * App-wide cTrader auto-sync. Lives in App so new closes keep landing in the
 * journal after the user leaves the Connect view (the old effect lived inside
 * EASetup and stopped on unmount).
 */
export function useCtraderAutoSync({
  userId,
  enabled,
  portfolios,
  trades,
  onTradesAddedBatch,
  onSynced,
  intervalMs = 60_000,
  firstRunLookbackMs = FIRST_RUN_LOOKBACK_MS,
}: UseCtraderAutoSyncOptions): void {
  const links = useMemo<CtraderPortfolioLink[]>(() => {
    const out: CtraderPortfolioLink[] = [];
    for (const portfolio of portfolios) {
      if (portfolio.isArchived) continue;
      for (const account of portfolio.accounts || []) {
        if (account.provider === 'ctrader' && account.externalAccountId) {
          out.push({
            portfolioId: portfolio.id,
            portfolioName: portfolio.name,
            accountId: String(account.externalAccountId),
          });
        }
      }
    }
    return out;
  }, [portfolios]);
  const linksKey = useMemo(
    () => links.map((link) => `${link.portfolioId}:${link.accountId}`).sort().join('|'),
    [links],
  );

  const tradesRef = useRef<Trade[]>(trades || []);
  const onTradesAddedBatchRef = useRef(onTradesAddedBatch);
  const onSyncedRef = useRef(onSynced);
  useEffect(() => { tradesRef.current = trades || []; }, [trades]);
  useEffect(() => { onTradesAddedBatchRef.current = onTradesAddedBatch; }, [onTradesAddedBatch]);
  useEffect(() => { onSyncedRef.current = onSynced; }, [onSynced]);

  useEffect(() => {
    if (!enabled || !userId || links.length === 0) return;
    let cancelled = false;
    let inFlight = false;

    const run = async () => {
      if (cancelled || inFlight || !isCtraderAutoSyncEnabled()) return;
      inFlight = true;
      try {
        const {
          hasActiveSession,
          getAccounts,
          getClosedDeals,
          getSymbolsList,
          buildDigitsMap,
        } = await import('../services/ctraderService');
        if (!hasActiveSession()) return;

        const accounts = await getAccounts().catch(() => null);
        // Cannot tell live from demo without the account list. Abort this run
        // rather than querying the wrong host and advancing the sync cursor.
        if (!accounts) return;
        const demoById = new Map<string, boolean>(
          accounts.map((account: any): [string, boolean] => [String(account.ctidTraderAccountId), Boolean(account.isDemo)]),
        );

        for (const link of links) {
          if (cancelled) break;
          const numericId = Number(link.accountId);
          if (!Number.isFinite(numericId)) continue;
          const isDemo = demoById.get(link.accountId);
          if (isDemo === undefined) continue;
          const now = Date.now();
          const lastSyncRaw = persistentGetSync(lastSyncKey(link.accountId, link.portfolioId));
          const lastSync = Number(lastSyncRaw) || 0;
          const from = lastSync ? Math.max(0, lastSync - OVERLAP_MS) : now - firstRunLookbackMs;

          const symbols = await getSymbolsList(numericId, isDemo).catch(() => []);
          const digitsById = buildDigitsMap(symbols);
          const deals = await getClosedDeals(numericId, from, now, isDemo, digitsById).catch(() => []);

          const savedDealIds = readSavedDealIds(link.accountId, link.portfolioId);
          const journalTickets = new Set(
            tradesRef.current.map((trade) => String(trade.ticketId || '').trim()).filter(Boolean),
          );
          const fresh = deals.filter((deal: any) => {
            const dealId = Number(deal?.dealId);
            if (!Number.isFinite(dealId) || savedDealIds.has(dealId)) return false;
            if (journalTickets.has(String(deal.dealId))) return false;
            const closeMs = deal?.closeTimestamp ? Date.parse(deal.closeTimestamp) : NaN;
            if (!Number.isFinite(closeMs) || closeMs <= 0) return false;
            if (lastSync && closeMs <= lastSync - OVERLAP_MS) return false;
            return lastSync > 0 || closeMs >= now - firstRunLookbackMs;
          });

          if (fresh.length > 0) {
            const built = fresh.map((deal: any) =>
              buildCtraderDealTrade(deal, { portfolioId: link.portfolioId, symbolsList: symbols }),
            );
            const saved = await dataService.batchAddTrades(built);
            const savedTrades = (Array.isArray(saved) ? saved : []).map((trade) =>
              trade.portfolio_id ? trade : { ...trade, portfolio_id: link.portfolioId },
            );
            if (savedTrades.length > 0) {
              onTradesAddedBatchRef.current?.(savedTrades);
              onSyncedRef.current?.(savedTrades.length, link.portfolioName);
            }
          }

          // Mark every fetched deal as seen even when the DB already had it, so
          // the overlap window does not re-import the same rows every minute.
          writeSavedDealIds(
            link.accountId,
            link.portfolioId,
            fresh.map((deal: any) => Number(deal.dealId)).filter(Number.isFinite),
          );
          persistentSet(lastSyncKey(link.accountId, link.portfolioId), String(now));
        }
      } catch {
        /* offline / expired grant: retry on the next tick */
      } finally {
        inFlight = false;
      }
    };

    void run();
    const intervalId = window.setInterval(run, intervalMs);
    const onFocus = () => void run();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void run();
    };
    const onAutoSyncChanged = () => void run();
    window.addEventListener('focus', onFocus);
    window.addEventListener(CTRADER_AUTOSYNC_EVENT, onAutoSyncChanged);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(CTRADER_AUTOSYNC_EVENT, onAutoSyncChanged);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, userId, linksKey, intervalMs, firstRunLookbackMs]);
}
