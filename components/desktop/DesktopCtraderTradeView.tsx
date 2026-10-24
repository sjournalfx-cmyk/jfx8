import React, { useEffect, useMemo, useState } from 'react';
import { CandlestickChart, LineChart, Zap } from 'lucide-react';
import { CtraderTradeTab } from '../mobile/CtraderTradeTab';
import { CtraderAccountPanel } from './CtraderAccountPanel';
import { CtraderConnectPrompt } from './CtraderConnectPrompt';
import { TradingNotificationToggle } from './TradingNotificationToggle';
import { useCtraderSymbols } from '../../hooks/useCtraderSymbols';
import { useTradingNotifications } from '../../hooks/useTradingNotifications';

interface DesktopCtraderTradeViewProps {
  ctidAccountId?: string | null;
  portfolioId?: string | null;
  timezone?: string;
  onGoConnect?: () => void;
  onViewChange?: (view: string) => void;
}

/** Desktop live-trading screen: market ticket + live account/positions. */
export const DesktopCtraderTradeView: React.FC<DesktopCtraderTradeViewProps> = ({
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
    <div className="h-full overflow-y-auto bg-[#0a0a0a] p-4 lg:p-6">
      <div className="mx-auto max-w-7xl">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FF4F01]/15 text-[#FF4F01]">
                <Zap size={16} />
              </span>
              <h1 className="text-2xl font-black tracking-tight text-white">Live Trading</h1>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${isDemo ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
                {isDemo ? 'Demo' : 'Live'}
              </span>
            </div>
            <p className="mt-1 text-sm text-zinc-500">
              {activeSymbol?.description || activeSymbol?.symbolName || 'Market execution'} · orders respect this portfolio&apos;s trading locks.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <TradingNotificationToggle />
            <button
              type="button"
              onClick={() => onViewChange?.('quotes')}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-[11px] font-bold text-zinc-300 hover:bg-white/[0.07]"
            >
              <LineChart size={13} /> Quotes
            </button>
            <button
              type="button"
              onClick={() => onViewChange?.('live-chart')}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-[11px] font-bold text-zinc-300 hover:bg-white/[0.07]"
            >
              <CandlestickChart size={13} /> Chart
            </button>
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
          <section className="overflow-hidden rounded-2xl border border-white/10 bg-black">
            <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
              <div>
                <h2 className="text-sm font-black text-white">Market order</h2>
                <p className="text-[11px] text-zinc-500">Buy or sell at the live broker quote.</p>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">cTrader</span>
            </div>
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
          </section>

          <aside className="min-w-0">
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-sm font-black text-white">Account & positions</h2>
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">Live P/L</span>
            </div>
            <CtraderAccountPanel
              ctidAccountId={ctidAccountId}
              portfolioId={portfolioId}
              timezone={timezone}
              onGoConnect={onGoConnect}
              mode="full"
              symbols={symbols}
              isDemo={isDemo}
              isLoadingSymbols={isLoading}
              symbolsError={error}
              onRefreshSymbols={reload}
            />
          </aside>
        </div>
      </div>
    </div>
  );
};

export default DesktopCtraderTradeView;
