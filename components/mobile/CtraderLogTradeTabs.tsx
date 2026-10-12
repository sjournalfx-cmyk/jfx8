import React, { useEffect, useState } from 'react';
import { List, Zap } from 'lucide-react';
import { CtraderQuotesTab } from './CtraderQuotesTab';
import { CtraderAccountCard } from './CtraderAccountCard';
import { CtraderTradeDetail } from './CtraderTradeDetail';
import { CtraderChartView } from './CtraderChartView';
import { CtraderQuoteSheet } from './CtraderQuoteSheet';
import { useCtraderSymbols } from '../../hooks/useCtraderSymbols';
import { haptic } from '../../lib/haptics';

type CtraderLogTab = 'quotes' | 'trade';

interface CtraderLogTradeTabsProps {
  ctidAccountId?: string | null;
  isDemoMode?: boolean;
  onGoConnect?: () => void;
  currencySymbol?: string;
  /** Fired when the full-screen trade detail opens/closes (hides the bottom nav). */
  onDetailOpenChange?: (open: boolean) => void;
  portfolioId?: string | null;
  timezone?: string;
}

/**
 * cTrader-scoped Log view: MT5-style Quotes picker + live Trade
 * (market execution) tab. The switcher intentionally copies the
 * Journal List/Calendar segmented control (Journal.tsx) so the look
 * stays identical: rounded container, orange active pill.
 */
export const CtraderLogTradeTabs: React.FC<CtraderLogTradeTabsProps> = ({
  ctidAccountId,
  isDemoMode,
  onGoConnect,
  currencySymbol = '$',
  onDetailOpenChange,
  portfolioId,
  timezone,
}) => {
  const [tab, setTab] = useState<CtraderLogTab>('quotes');
  const { symbols, isLoading, error, isDemo, reload } = useCtraderSymbols(ctidAccountId);
  const [symbolId, setSymbolId] = useState<number | null>(null);
  // Full-screen trade page opened from a Quotes row (no bottom nav).
  const [detailId, setDetailId] = useState<number | null>(null);
  // Full-screen chart opened from the quote drawer (no bottom nav).
  const [chartId, setChartId] = useState<number | null>(null);
  // Quote tap drawer (New Order / Chart) — tap no longer jumps straight in.
  const [sheetId, setSheetId] = useState<number | null>(null);
  // Add-symbols browser open inside Quotes (hides the tab switcher).
  const [isAdding, setIsAdding] = useState(false);

  // Default to the first symbol once loaded; keep the Quotes highlight
  // and the Trade tab in sync.
  useEffect(() => {
    if (symbolId !== null) return;
    if (symbols.length === 0) return;
    setSymbolId(symbols[0].symbolId);
  }, [symbolId, symbols]);

  useEffect(() => {
    setSymbolId(null);
    setTab('quotes');
    setDetailId(null);
    setChartId(null);
    setSheetId(null);
    setIsAdding(false);
  }, [ctidAccountId]);

  const pick = (next: CtraderLogTab) => {
    try {
      haptic.selection();
    } catch {}
    setIsAdding(false);
    setTab(next);
  };

  const pickSymbolAndTrade = (id: number) => {
    setSymbolId(id);
    setSheetId(null);
    setDetailId(id);
    onDetailOpenChange?.(true);
  };

  const pickSymbolAndChart = (id: number) => {
    setSymbolId(id);
    setSheetId(null);
    setChartId(id);
    onDetailOpenChange?.(true);
  };

  const closeDetail = () => {
    try {
      haptic.selection();
    } catch {}
    setDetailId(null);
    setTab('quotes');
    onDetailOpenChange?.(false);
  };

  const closeChart = () => {
    try {
      haptic.selection();
    } catch {}
    setChartId(null);
    setTab('quotes');
    onDetailOpenChange?.(false);
  };

  const sheetSymbol = sheetId !== null ? symbols.find((s) => Number(s.symbolId) === Number(sheetId)) ?? null : null;
  const chartSymbol = chartId !== null ? symbols.find((s) => Number(s.symbolId) === Number(chartId)) ?? null : null;

  if (chartId !== null) {
    // Full-screen overlay (fixed inset-0): the tab content column is a
    // block container, so flex-1 collapses and the canvas would fall back
    // to its 300x150 default. Viewport-anchored = definite height.
    return (
      <div className="fixed inset-0 z-[150] bg-[#000000] flex flex-col">
        <CtraderChartView
          ctidAccountId={ctidAccountId}
          isDemo={isDemo}
          symbolId={chartId}
          symbolName={chartSymbol?.symbolName ?? `#${chartId}`}
          digits={chartSymbol?.digits}
          onClose={closeChart}
          symbols={symbols}
          onSymbolChange={(id) => {
            setSymbolId(id);
            setChartId(id);
          }}
        />
      </div>
    );
  }

  if (detailId !== null) {
    return (
      <CtraderTradeDetail
        ctidAccountId={ctidAccountId}
        isDemoMode={isDemoMode}
        symbols={symbols}
        isDemo={isDemo}
        isLoadingSymbols={isLoading}
        symbolsError={error}
        symbolId={detailId}
        onSymbolChange={(id) => {
          if (id !== null) {
            setSymbolId(id);
            setDetailId(id);
          }
        }}
        onRefreshSymbols={reload}
        onClose={closeDetail}
        onGoConnect={onGoConnect}
        portfolioId={portfolioId}
        timezone={timezone}
      />
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#000000]">
      {!isAdding && (
      <div className="shrink-0 px-2 pt-3 pb-2">
        <div className="flex rounded-lg border overflow-hidden p-0.5 gap-0.5 w-full sm:w-auto border-[#27272a] bg-[#000000]">
          <button
            onClick={() => pick('quotes')}
            aria-label="Switch to Quotes tab"
            className={`h-11 min-h-[44px] py-1.5 px-2.5 rounded flex flex-1 justify-center items-center gap-1.5 text-xs font-bold transition-all sm:flex-none ${
              tab === 'quotes' ? 'bg-[#FF4F00] text-white shadow' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <List size={14} /> Quotes
          </button>
          <button
            onClick={() => pick('trade')}
            aria-label="Switch to Trade tab"
            className={`h-11 min-h-[44px] py-1.5 px-2.5 rounded flex flex-1 justify-center items-center gap-1.5 text-xs font-bold transition-all sm:flex-none ${
              tab === 'trade' ? 'bg-[#FF4F00] text-white shadow' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Zap size={14} /> Trade
          </button>
        </div>
      </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {tab === 'quotes' ? (
          <>
          <CtraderQuotesTab
            symbols={symbols}
            isLoading={isLoading}
            error={error}
            selectedSymbolId={symbolId}
            onSelect={(id) => setSheetId(id)}
            onRetry={reload}
            ctidAccountId={ctidAccountId}
            isDemo={isDemo}
            portfolioId={portfolioId}
            onAddingChange={setIsAdding}
          />
          {sheetSymbol !== null && sheetId !== null && (
            <CtraderQuoteSheet
              symbolName={sheetSymbol.symbolName}
              onNewOrder={() => pickSymbolAndTrade(sheetId)}
              onChart={() => pickSymbolAndChart(sheetId)}
              onClose={() => setSheetId(null)}
            />
          )}
          </>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
            <CtraderAccountCard
              ctidAccountId={ctidAccountId}
              isDemo={isDemo}
              symbols={symbols}
              onGoConnect={onGoConnect}
            />
          </div>
        )}
      </div>
    </div>
  );
};
