import React, { useEffect, useMemo, useState } from 'react';
import { CandlestickChart, List, Zap } from 'lucide-react';
import { CtraderChartView } from '../mobile/CtraderChartView';
import { CtraderTradeTab } from '../mobile/CtraderTradeTab';
import { CtraderConnectPrompt } from './CtraderConnectPrompt';
import { TradingNotificationToggle } from './TradingNotificationToggle';
import { useCtraderSymbols } from '../../hooks/useCtraderSymbols';
import { useTradingNotifications } from '../../hooks/useTradingNotifications';

interface DesktopCtraderChartViewProps {
  ctidAccountId?: string | null;
  portfolioId?: string | null;
  timezone?: string;
  onGoConnect?: () => void;
  onViewChange?: (view: string) => void;
}

/** Desktop live chart with a persistent quick-trade ticket and fullscreen toggle. */
export const DesktopCtraderChartView: React.FC<DesktopCtraderChartViewProps> = ({
  ctidAccountId,
  portfolioId,
  timezone,
  onGoConnect,
  onViewChange,
}) => {
  const { symbols, isLoading, error, isDemo, reload } = useCtraderSymbols(ctidAccountId);
  const { notify } = useTradingNotifications();
  const [symbolId, setSymbolId] = useState<number | null>(null);

  useEffect(() => {
    if (symbolId !== null || symbols.length === 0) return;
    setSymbolId(symbols[0].symbolId);
  }, [symbolId, symbols]);

  const activeSymbol = useMemo(
    () => symbols.find((s) => Number(s.symbolId) === Number(symbolId)) ?? null,
    [symbols, symbolId]
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
      <div className="mx-auto flex h-full w-full max-w-[1800px] flex-col">
        <header className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FF4F01]/15 text-[#FF4F01]">
                <CandlestickChart size={16} />
              </span>
              <h1 className="text-2xl font-black tracking-tight text-white">Live Chart</h1>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${isDemo ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
                {isDemo ? 'Demo' : 'Live'}
              </span>
            </div>
            <p className="mt-1 text-sm text-zinc-500">
              {activeSymbol?.symbolName || 'Select a pair'} · fullscreen chart with quick market execution.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <TradingNotificationToggle />
            <button
              type="button"
              onClick={() => onViewChange?.('quotes')}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-[11px] font-bold text-zinc-300 hover:bg-white/[0.07]"
            >
              <List size={13} /> Quotes
            </button>
            <button
              type="button"
              onClick={() => onViewChange?.('trade')}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-[11px] font-bold text-zinc-300 hover:bg-white/[0.07]"
            >
              <Zap size={13} /> Trade
            </button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-black">
            {symbolId !== null ? (
              <CtraderChartView
                ctidAccountId={ctidAccountId}
                isDemo={isDemo}
                symbolId={symbolId}
                symbolName={activeSymbol?.symbolName ?? `#${symbolId}`}
                digits={activeSymbol?.digits}
                onClose={() => onViewChange?.('quotes')}
                symbols={symbols}
                onSymbolChange={(id) => setSymbolId(id)}
                enableFullscreen
              />
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">Loading symbols…</div>
            )}
          </section>

          <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-black">
            <div className="shrink-0 border-b border-white/5 px-4 py-3">
              <h2 className="text-sm font-black text-white">Quick trade</h2>
              <p className="text-[11px] text-zinc-500">Market order for the chart symbol.</p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <CtraderTradeTab
                ctidAccountId={ctidAccountId}
                symbols={symbols}
                isDemo={isDemo}
                isLoadingSymbols={isLoading}
                symbolsError={error}
                symbolId={symbolId}
                onSymbolChange={setSymbolId}
                onRefreshSymbols={reload}
                compact
                portfolioId={portfolioId}
                timezone={timezone}
                onGoConnect={onGoConnect}
                onTradingEvent={notify}
              />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default DesktopCtraderChartView;
