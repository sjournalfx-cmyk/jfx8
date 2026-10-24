import React, { useState } from 'react';
import { CtraderAccountCard } from '../mobile/CtraderAccountCard';
import { CtraderTradeDetail } from '../mobile/CtraderTradeDetail';
import { useCtraderSymbols, type CtraderQuoteSymbol } from '../../hooks/useCtraderSymbols';
import { useTradingNotifications } from '../../hooks/useTradingNotifications';

interface CtraderAccountPanelProps {
  ctidAccountId?: string | null;
  portfolioId?: string | null;
  timezone?: string;
  mode?: 'full' | 'summary' | 'positions';
  onGoConnect?: () => void;
  className?: string;
  /** Optional shared symbol state (avoids duplicate fetches on a page). */
  symbols?: CtraderQuoteSymbol[];
  isDemo?: boolean;
  isLoadingSymbols?: boolean;
  symbolsError?: string | null;
  onRefreshSymbols?: () => void;
}

/**
 * Desktop account panel. Wraps the mobile account card (balance/equity/margin
 * plus live positions with close and SL/TP editing) and opens the existing
 * trade-detail ticket in a desktop modal.
 */
export const CtraderAccountPanel: React.FC<CtraderAccountPanelProps> = ({
  ctidAccountId,
  portfolioId,
  timezone,
  mode = 'full',
  onGoConnect,
  className = '',
  symbols: symbolsProp,
  isDemo: isDemoProp,
  isLoadingSymbols: isLoadingProp,
  symbolsError: symbolsErrorProp,
  onRefreshSymbols,
}) => {
  const fallback = useCtraderSymbols(symbolsProp === undefined ? ctidAccountId : null);
  const symbols = symbolsProp ?? fallback.symbols;
  const isDemo = isDemoProp ?? fallback.isDemo;
  const isLoading = isLoadingProp ?? fallback.isLoading;
  const error = symbolsErrorProp ?? fallback.error;
  const reload = onRefreshSymbols ?? fallback.reload;
  const { notify } = useTradingNotifications();
  const [detailId, setDetailId] = useState<number | null>(null);

  const detailSymbol = detailId !== null
    ? symbols.find((s) => Number(s.symbolId) === Number(detailId)) ?? null
    : null;

  return (
    <>
      <div className={className}>
        <CtraderAccountCard
          ctidAccountId={ctidAccountId}
          isDemo={isDemo}
          symbols={symbols}
          onGoConnect={onGoConnect}
          embedded
          mode={mode}
          onTradingEvent={notify}
          onOpenTradeDetail={(symbolId) => setDetailId(symbolId)}
        />
      </div>

      {detailId !== null && (
        <div className="fixed inset-0 z-[240] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setDetailId(null)}
            aria-label="Close trade detail"
          />
          <div className="relative z-10 flex h-[min(86vh,760px)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl">
            <CtraderTradeDetail
              ctidAccountId={ctidAccountId}
              symbols={symbols}
              isDemo={isDemo}
              isLoadingSymbols={isLoading}
              symbolsError={error}
              symbolId={detailId}
              onSymbolChange={(id) => {
                if (id !== null) setDetailId(id);
              }}
              onRefreshSymbols={reload}
              onClose={() => setDetailId(null)}
              onGoConnect={onGoConnect}
              portfolioId={portfolioId}
              timezone={timezone}
              onTradingEvent={notify}
            />
            {detailSymbol && (
              <p className="border-t border-white/5 px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                {detailSymbol.symbolName} · {isDemo ? 'Demo' : 'Live'}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
};
