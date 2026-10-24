import React, { useMemo, useState } from 'react';
import { LineChart, List, Zap } from 'lucide-react';
import { CtraderQuotesTab } from '../mobile/CtraderQuotesTab';
import { CtraderQuoteSheet } from '../mobile/CtraderQuoteSheet';
import { CtraderTradeDetail } from '../mobile/CtraderTradeDetail';
import { CtraderChartView } from '../mobile/CtraderChartView';
import { CtraderConnectPrompt } from './CtraderConnectPrompt';
import { TradingNotificationToggle } from './TradingNotificationToggle';
import { useCtraderSymbols } from '../../hooks/useCtraderSymbols';
import { useTradingNotifications } from '../../hooks/useTradingNotifications';

interface DesktopCtraderQuotesViewProps {
  ctidAccountId?: string | null;
  portfolioId?: string | null;
  timezone?: string;
  onGoConnect?: () => void;
  onViewChange?: (view: string) => void;
}

/** Desktop watchlist with an inline quote-action panel instead of a bottom sheet. */
export const DesktopCtraderQuotesView: React.FC<DesktopCtraderQuotesViewProps> = ({
  ctidAccountId,
  portfolioId,
  timezone,
  onGoConnect,
  onViewChange,
}) => {
  const { symbols, isLoading, error, isDemo, reload } = useCtraderSymbols(ctidAccountId);
  const { notify } = useTradingNotifications();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [chartId, setChartId] = useState<number | null>(null);

  const selectedSymbol = useMemo(
    () => symbols.find((s) => Number(s.symbolId) === Number(selectedId)) ?? null,
    [symbols, selectedId]
  );
  const detailSymbol = useMemo(
    () => symbols.find((s) => Number(s.symbolId) === Number(detailId)) ?? null,
    [symbols, detailId]
  );
  const chartSymbol = useMemo(
    () => symbols.find((s) => Number(s.symbolId) === Number(chartId)) ?? null,
    [symbols, chartId]
  );

  if (!ctidAccountId) {
    return (
      <div className="h-full overflow-y-auto bg-[#0a0a0a] p-4 lg:p-6">
        <div className="mx-auto max-w-7xl">
          <CtraderConnectPrompt onGoConnect={onGoConnect} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#0a0a0a] p-4 lg:p-6">
      <div className="mx-auto flex h-full w-full max-w-7xl flex-col">
        <header className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FF4F01]/15 text-[#FF4F01]">
                <List size={16} />
              </span>
              <h1 className="text-2xl font-black tracking-tight text-white">Quotes</h1>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${isDemo ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
                {isDemo ? 'Demo' : 'Live'}
              </span>
            </div>
            <p className="mt-1 text-sm text-zinc-500">Live cTrader watchlist. Pick a pair to place an order or open its chart.</p>
          </div>
          <div className="flex items-center gap-2">
            <TradingNotificationToggle />
            <button
              type="button"
              onClick={() => onViewChange?.('trade')}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-[11px] font-bold text-zinc-300 hover:bg-white/[0.07]"
            >
              <Zap size={13} /> Trade
            </button>
            <button
              type="button"
              onClick={() => onViewChange?.('live-chart')}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-[11px] font-bold text-zinc-300 hover:bg-white/[0.07]"
            >
              <LineChart size={13} /> Chart
            </button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-black">
            <CtraderQuotesTab
              symbols={symbols}
              isLoading={isLoading}
              error={error}
              selectedSymbolId={selectedId}
              onSelect={(id) => setSelectedId(id)}
              onRetry={reload}
              onReconnect={onGoConnect}
              ctidAccountId={ctidAccountId}
              isDemo={isDemo}
              portfolioId={portfolioId}
            />
          </section>

          <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto">
            {selectedSymbol ? (
              <CtraderQuoteSheet
                variant="panel"
                symbolName={selectedSymbol.symbolName}
                onNewOrder={() => setDetailId(selectedSymbol.symbolId)}
                onChart={() => setChartId(selectedSymbol.symbolId)}
                onClose={() => setSelectedId(null)}
              />
            ) : (
              <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.01] p-5 text-center">
                <p className="text-sm font-bold text-zinc-300">Select a pair</p>
                <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
                  Click any quote to open New Order and Chart actions here.
                </p>
              </div>
            )}
            <div className="rounded-xl border border-white/10 bg-[#0b0b0c] p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600">Watchlist</p>
              <p className="mt-2 text-[12px] leading-relaxed text-zinc-500">
                Live prices stream over the same cTrader session used by mobile. Trading locks filter blocked pairs before the ticket opens.
              </p>
            </div>
          </aside>
        </div>
      </div>

      {detailId !== null && (
        <div className="fixed inset-0 z-[240] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setDetailId(null)} aria-label="Close trade detail" />
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

      {chartId !== null && (
        <div className="fixed inset-0 z-[240] flex flex-col bg-black">
          <CtraderChartView
            ctidAccountId={ctidAccountId}
            isDemo={isDemo}
            symbolId={chartId}
            symbolName={chartSymbol?.symbolName ?? `#${chartId}`}
            digits={chartSymbol?.digits}
            onClose={() => setChartId(null)}
            symbols={symbols}
            onSymbolChange={(id) => {
              setSelectedId(id);
              setChartId(id);
            }}
            enableFullscreen
          />
        </div>
      )}
    </div>
  );
};

export default DesktopCtraderQuotesView;
