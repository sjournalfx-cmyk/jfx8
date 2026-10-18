import React, { useEffect, useMemo } from 'react';
import { X, TrendingUp, TrendingDown, CheckCircle2, NotebookPen, Compass, ArrowRight } from 'lucide-react';
import { Trade } from '../types';
import { calculateRiskReward } from '../lib/trade-calculations';
import { getSASTDateTime } from '../lib/timeUtils';

interface TradeRecapSheetProps {
  isOpen: boolean;
  trade: Trade | null;
  /** All current trades — used for the "journaled this week" progress line. */
  trades: Trade[];
  currencySymbol: string;
  isDarkMode?: boolean;
  /** Opens the saved trade in the editor. */
  onAddNotes: () => void;
  /** Jumps to the existing Daily Bias UI. */
  onSetBias: () => void;
  /** Goes to the trade history/journal. */
  onDone: () => void;
  /** Backdrop / Escape dismissal (treated as Done). */
  onClose: () => void;
}

/** A trade counts as "journaled" once it carries any reflection. */
const isJournaled = (trade: Trade): boolean =>
  Boolean(trade.notes && trade.notes.trim()) ||
  (Array.isArray(trade.emotions) && trade.emotions.length > 0) ||
  Boolean(trade.mindset && trade.mindset.trim());

const formatMoney = (value: number, symbol: string): string => {
  const abs = Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${value < 0 ? '-' : ''}${symbol}${abs}`;
};

const TradeRecapSheet: React.FC<TradeRecapSheetProps> = ({
  isOpen,
  trade,
  trades,
  currencySymbol,
  isDarkMode = true,
  onAddNotes,
  onSetBias,
  onDone,
  onClose,
}) => {
  // Escape + body scroll lock while the sheet owns the screen.
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, onClose]);

  // Monday-anchored week (SAST) matching the Daily Bias widget.
  const weekDates = useMemo(() => {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(now.setDate(diff));
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return getSASTDateTime(d).date;
    });
  }, []);

  const weekly = useMemo(() => {
    const weekTrades = trades.filter((t) => t.date && weekDates.includes(t.date));
    const journaled = weekTrades.filter(isJournaled).length;
    return { total: weekTrades.length, journaled };
  }, [trades, weekDates]);

  const rMultiple = useMemo(() => {
    if (!trade) return null;
    try {
      const { risk } = calculateRiskReward({
        entryPrice: trade.entryPrice,
        stopLoss: trade.stopLoss,
        takeProfit: trade.takeProfit,
        exitPrice: trade.exitPrice,
        lots: trade.lots,
        pair: trade.pair,
        assetType: trade.assetType,
        contractSize: trade.contractSize,
        direction: trade.direction,
      });
      if (risk > 0 && Number.isFinite(trade.pnl)) {
        const r = trade.pnl / risk;
        return Number.isFinite(r) ? r : null;
      }
    } catch {
      // Missing/partial trade data — omit the R multiple rather than guess.
    }
    return null;
  }, [trade]);

  if (!isOpen || !trade) return null;

  const isWin = trade.pnl >= 0;
  const surface = isDarkMode
    ? 'bg-[#0a0a0a] border-white/10 text-zinc-200'
    : 'bg-white border-slate-200 text-slate-800';
  const muted = isDarkMode ? 'text-zinc-500' : 'text-slate-500';

  return (
    <div className="fixed inset-0 z-[220] flex items-end justify-center sm:items-center p-0 sm:p-6">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-sheet-fade"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Trade logged"
        className={`jfx-recap-pop relative w-full sm:max-w-md max-h-[90dvh] overflow-y-auto rounded-t-[28px] sm:rounded-[28px] border shadow-2xl ${surface}`}
      >
        <div className="mx-auto mt-3 h-1 w-9 rounded-full bg-white/20 sm:hidden" aria-hidden="true" />

        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          className={`absolute right-4 top-4 rounded-lg p-2 transition-colors ${isDarkMode ? 'text-zinc-500 hover:text-white hover:bg-white/5' : 'text-slate-400 hover:text-slate-700 hover:bg-black/5'}`}
        >
          <X size={18} />
        </button>

        <div className="px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 sm:pb-8">
          <div className="flex flex-col items-center text-center">
            <div className="jfx-recap-glow flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
              <CheckCircle2 size={28} />
            </div>
            <p className="mt-3 text-[10px] font-black uppercase tracking-[0.25em] text-emerald-400">Trade logged</p>

            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              <h2 className="text-2xl font-black tracking-tight">{trade.pair || 'Trade'}</h2>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${
                  trade.direction === 'Long'
                    ? 'bg-teal-500/10 text-teal-400'
                    : 'bg-rose-500/10 text-rose-400'
                }`}
              >
                {trade.direction === 'Long' ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                {trade.direction}
              </span>
            </div>

            <p className={`mt-4 text-[11px] font-bold uppercase tracking-widest ${muted}`}>P&amp;L</p>
            <p className={`jfx-value-mono text-4xl font-black ${isWin ? 'text-emerald-400' : 'text-rose-400'}`}>
              {formatMoney(trade.pnl || 0, currencySymbol)}
            </p>

            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              {rMultiple !== null && (
                <span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-widest ${isDarkMode ? 'bg-white/5 text-zinc-300' : 'bg-slate-100 text-slate-600'}`}>
                  {rMultiple >= 0 ? '+' : ''}{rMultiple.toFixed(2)}R
                </span>
              )}
              {trade.planAdherence && (
                <span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-widest ${isDarkMode ? 'bg-white/5 text-zinc-300' : 'bg-slate-100 text-slate-600'}`}>
                  {trade.planAdherence}
                </span>
              )}
            </div>
          </div>

          <div className={`mt-6 rounded-2xl border px-4 py-3 text-center ${isDarkMode ? 'border-white/5 bg-white/[0.02]' : 'border-slate-100 bg-slate-50'}`}>
            <p className={`text-[13px] font-bold ${isDarkMode ? 'text-zinc-300' : 'text-slate-600'}`}>
              <span className="text-[#FF4F01]">{weekly.journaled}</span> of {weekly.total} trades journaled this week
            </p>
            <p className={`mt-0.5 text-[11px] font-medium ${muted}`}>
              Add notes &amp; feelings while it&apos;s fresh to build your edge.
            </p>
          </div>

          <div className="mt-6 flex flex-col gap-2">
            <button
              type="button"
              onClick={onAddNotes}
              className="flex min-h-[44px] items-center justify-center gap-2 rounded-2xl bg-[#FF4F01] px-4 py-3 text-sm font-black text-white shadow-lg shadow-[#FF4F01]/20 transition-all hover:bg-[#e64601] active:scale-[0.98] touch-manipulation"
            >
              <NotebookPen size={16} /> Add notes &amp; feelings
            </button>
            <button
              type="button"
              onClick={onSetBias}
              className={`flex min-h-[44px] items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-black transition-all active:scale-[0.98] touch-manipulation ${
                isDarkMode ? 'border-white/10 text-zinc-200 hover:bg-white/5' : 'border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Compass size={16} /> Set tomorrow&apos;s bias
            </button>
            <button
              type="button"
              onClick={onDone}
              className={`flex min-h-[44px] items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-black transition-all active:scale-[0.98] touch-manipulation ${
                isDarkMode ? 'text-zinc-400 hover:text-white' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Done <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TradeRecapSheet;
