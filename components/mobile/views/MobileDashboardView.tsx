import React, { useMemo } from 'react';
import { Trade, UserProfile, EASession, Portfolio } from '../../../types';
import { calculateStats } from '../../../lib/statsUtils';
import { getCompletedTrades } from '../../../lib/analyticsUtils';
import { resolveBridgeBackedBalance } from '../../../lib/bridgeBalance';
import SessionClock from '../../SessionClock';
import DailyQuote from '../../DailyQuote';
import OpenPositions from '../../OpenPositions';
import { MobileEconomicCalendarWidget } from '../MobileEconomicCalendarWidget';
import { AlertCircle, FileText, Activity, ChevronRight } from 'lucide-react';

interface MobileDashboardViewProps {
  trades: Trade[];
  userProfile?: UserProfile;
  eaSession?: EASession | null;
  lastKnownBridgeBalance?: import('../../../lib/bridgeBalance').StoredBridgeBalance | number | null;
  isBridgeOnline?: boolean;
  isDemoMode?: boolean;
  isDarkMode?: boolean;
  activePortfolio?: Portfolio | null;
  defaultPortfolioId?: string | null;
  // Pre-computed by App.tsx (single source of truth, already portfolio-scoped).
  // When provided, the card uses these verbatim instead of deriving locally.
  initialBalance?: number;
  currentBalance?: number;
  // When the card shows a live broker balance (cTrader / bridge) instead of
  // journal math, the caption says so rather than a misleading PnL/ROI line.
  liveBalanceSource?: 'bridge' | 'ctrader' | null;
  isLiveBalance?: boolean;
  /** Navigate to another view (e.g. the trade journal from Needs attention). */
  onViewChange?: (view: string) => void;
}

export const MobileDashboardView: React.FC<MobileDashboardViewProps> = ({
  trades,
  userProfile,
  eaSession,
  lastKnownBridgeBalance,
  isBridgeOnline = false,
  isDemoMode = false,
  activePortfolio = null,
  defaultPortfolioId = null,
  initialBalance: initialBalanceOverride,
  currentBalance: currentBalanceOverride,
  liveBalanceSource = null,
  isLiveBalance = false,
  onViewChange,
}) => {
  const completedTrades = useMemo(() => getCompletedTrades(trades), [trades]);
  const stats = useMemo(() => calculateStats(completedTrades), [completedTrades]);

  const currencySymbol = userProfile?.currencySymbol || '$';

  const fmt = (val: number, showSign = false): string => {
    const abs = Math.abs(val).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    if (showSign) return val >= 0 ? `+${currencySymbol}${abs}` : `-${currencySymbol}${abs}`;
    return `${currencySymbol}${abs}`;
  };

  const fmtMoney2 = (val: number): string => {
    const abs = Math.abs(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${val < 0 ? '-' : ''}${currencySymbol}${abs}`;
  };

  const totalTrades = completedTrades.length;
  const realizedPnL = stats.netProfit || 0;
  const profitFactor = (stats.profitFactor && Number.isFinite(stats.profitFactor))
    ? stats.profitFactor.toFixed(2) : '0.00';
  const winRate = stats.winRate ? Number(stats.winRate).toFixed(1) : '0.0';
  const wins = completedTrades.filter(t => t.result === 'Win').length;
  const losses = completedTrades.filter(t => t.result === 'Loss').length;

  // ── Needs attention (progressive nudge — card hides when nothing pending) ──
  const openPositionsCount = eaSession?.data?.openPositions?.length || 0;

  const staleNoteCount = useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const toTs = (t: Trade): number => {
      const raw = t.closeTime || t.openTime;
      const parsed = raw ? Date.parse(raw) : NaN;
      if (Number.isFinite(parsed)) return parsed;
      const dateParsed = t.date ? Date.parse(`${t.date}T12:00:00`) : NaN;
      return Number.isFinite(dateParsed) ? dateParsed : NaN;
    };
    return trades.filter((t) => {
      if (!t.date) return false;
      const ts = toTs(t);
      if (!Number.isFinite(ts) || ts < cutoff) return false;
      const hasNotes = Boolean(t.notes && t.notes.trim());
      const hasEmotions = Array.isArray(t.emotions) && t.emotions.length > 0;
      const hasMindset = Boolean(t.mindset && t.mindset.trim());
      return !(hasNotes || hasEmotions || hasMindset);
    }).length;
  }, [trades]);

  const hasNeedsAttention = staleNoteCount > 0 || openPositionsCount > 0;

  // ── Account Balance (portfolio-aware) ──────────────────────────────
  // `trades` here are already scoped to the active portfolio by App.tsx,
  // so realizedPnL is per-portfolio. Initial comes from the portfolio's own
  // startingBalance (Default falls back to the profile initialBalance).
  const isDefaultPortfolio =
    !activePortfolio ||
    activePortfolio.isDefault ||
    (defaultPortfolioId != null && activePortfolio.id === defaultPortfolioId);

  const initialBal = initialBalanceOverride ?? (
    activePortfolio?.startingBalance ??
    (isDefaultPortfolio ? userProfile?.initialBalance : undefined) ??
    0
  );

  // Only bridge-sourced portfolios may consume the EA bridge balance.
  // Manual / cTrader portfolios must never leak the global bridge snapshot.
  const isBridgePortfolio =
    activePortfolio?.source === 'bridge' ||
    (isDefaultPortfolio && Boolean(userProfile?.eaConnected));

  const derivedBalance = (!isDemoMode && isBridgePortfolio)
    ? resolveBridgeBackedBalance({
        userProfile,
        totalPnL: realizedPnL,
        eaSession,
        lastKnownBridgeBalance,
        isBridgeOnline,
        isDemoMode,
      })
    : initialBal + realizedPnL;

  const currentBalance = currentBalanceOverride ?? derivedBalance;
  const balanceDelta = currentBalance - initialBal;
  const roiPct = initialBal > 0 ? (balanceDelta / initialBal) * 100 : 0;

  // Live positions
  const openPositionsData = useMemo(() => {
    const raw = eaSession?.data?.openPositions || [];
    return raw.map(p => ({
      ticket: p.ticket,
      symbol: p.symbol,
      type: p.type,
      openTime: p.time ? new Date(p.time * 1000).toISOString() : new Date().toISOString(),
      openPrice: p.open_price,
      currentPrice: p.current_price,
      sl: p.sl || 0,
      tp: p.tp || 0,
      lots: p.volume,
      swap: 0,
      profit: p.profit,
      comment: p.comment,
    }));
  }, [eaSession]);

  return (
    <div className="pb-nav px-3.5 pt-3 space-y-3.5">
      {/* 0. Needs attention — only rendered when something is actually pending */}
      {hasNeedsAttention && (
        <div className="jfx-card jfx-card-accent p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle size={16} className="text-[#FF4F01]" />
            <p className="jfx-label">Needs attention</p>
          </div>
          <div className="space-y-2">
            {staleNoteCount > 0 && (
              <button
                type="button"
                onClick={() => onViewChange?.('history')}
                className="w-full flex items-center gap-3 min-h-[44px] rounded-xl bg-white/[0.03] px-3 py-2 text-left transition-colors hover:bg-white/[0.06] touch-manipulation"
              >
                <FileText size={16} className="text-amber-400 shrink-0" />
                <span className="flex-1 text-[13px] font-bold text-zinc-200">
                  {staleNoteCount} trade{staleNoteCount === 1 ? '' : 's'} from the last 7 days need notes
                </span>
                <ChevronRight size={16} className="text-zinc-600 shrink-0" />
              </button>
            )}
            {openPositionsCount > 0 && (
              <div className="flex items-center gap-3 min-h-[44px] rounded-xl bg-white/[0.03] px-3 py-2">
                <Activity size={16} className="text-emerald-400 shrink-0" />
                <span className="flex-1 text-[13px] font-bold text-zinc-200">
                  {openPositionsCount} open position{openPositionsCount === 1 ? '' : 's'}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 1. Stats Grid — 2x2 on mobile (matches desktop) */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-4 rounded-[16px] border-0 bg-[#0a0a0a] text-white">
          <p className="text-[11px] font-bold uppercase tracking-widest opacity-40 text-left">Net PnL</p>
          <p className="text-[22px] font-black jfx-value-mono text-white mt-1">{fmt(realizedPnL, true)}</p>
        </div>
        <div className="p-4 rounded-[16px] border-0 bg-[#0a0a0a] text-white">
          <p className="text-[11px] font-bold uppercase tracking-widest opacity-40 text-left">Win Rate</p>
          <p className="text-[22px] font-black jfx-value-mono text-white mt-1">{winRate}%</p>
          <p className="text-[11px] font-medium opacity-40 mt-1">{wins}W - {losses}L</p>
        </div>
        <div className="p-4 rounded-[16px] border-0 bg-[#0a0a0a] text-white">
          <p className="text-[11px] font-bold uppercase tracking-widest opacity-40 text-left">Profit Factor</p>
          <p className="text-[22px] font-black jfx-value-mono text-white mt-1">{profitFactor}</p>
        </div>
        <div className="p-4 rounded-[16px] border-0 bg-[#0a0a0a] text-white">
          <p className="text-[11px] font-bold uppercase tracking-widest opacity-40 text-left">Total Trades</p>
          <p className="text-[22px] font-black jfx-value-mono text-white mt-1">{totalTrades}</p>
        </div>
      </div>

      {/* 2. Daily Motivation / Quote Widget */}
      <DailyQuote isDarkMode={true} />

      {/* 3. Live Global Session Clock */}
      <SessionClock isDarkMode={true} />

      {/* 4. Economic Calendar */}
      <MobileEconomicCalendarWidget />

      {/* 5. Live Positions Widget */}
      {openPositionsData.length > 0 && (
        <div className="jfx-card p-4">
          <p className="jfx-label mb-3">Bridge Open Positions</p>
          <OpenPositions positions={openPositionsData} isDarkMode={true} currencySymbol={currencySymbol} />
        </div>
      )}

      {/* 6. Account Balance — functional, per-portfolio */}
      <div className="jfx-card p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="jfx-label">Account Balance</p>
          {activePortfolio?.name ? (
            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 truncate max-w-[50%]">
              {activePortfolio.name}
            </span>
          ) : null}
        </div>
        <p className="text-[28px] leading-none font-black jfx-value-mono text-white">{fmtMoney2(currentBalance)}</p>
        {liveBalanceSource === 'ctrader' ? (
          <p className="jfx-caption mt-1.5">
            Live broker balance · cTrader{isLiveBalance ? '' : ' · last synced'}
          </p>
        ) : liveBalanceSource === 'bridge' ? (
          <p className="jfx-caption mt-1.5">
            Live broker balance · Bridge{isLiveBalance ? '' : ' · last synced'}
          </p>
        ) : initialBal > 0 ? (
          <p className="jfx-caption mt-1.5">
            Initial {fmtMoney2(initialBal)} · {balanceDelta >= 0 ? '+' : ''}{roiPct.toFixed(1)}% ROI
          </p>
        ) : (
          <p className="jfx-caption mt-1.5">
            No starting balance set{activePortfolio?.name ? ` for ${activePortfolio.name}` : ''} · {fmtMoney2(balanceDelta)} PnL
          </p>
        )}
      </div>
    </div>
  );
};
