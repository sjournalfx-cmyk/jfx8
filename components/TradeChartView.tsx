import React, { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, ChevronDown, AlertTriangle, Wifi, Clock, Settings, Cloud, CloudCheck } from 'lucide-react';
import { Trade, Candle } from '../types';
import {
  fetchCtraderCandles,
  isAuthenticated as isCtraderAuthenticated,
  getAccounts as getCtraderAccounts,
} from '../services/ctraderService';
import CustomChart from './CustomChart';
import { Drawing } from './backtest/types';

// ─── Props ────────────────────────────────────────────────────────────────────

interface TradeChartViewProps {
  trade: Trade;
  isDarkMode: boolean;
  onOpenSettings?: () => void;
  onSaveCandles?: (candles: Candle[], timeframe: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Seconds per bar for each timeframe label */
const TF_SECONDS: Record<string, number> = {
  M1: 60, M5: 300, M15: 900, M30: 1800,
  H1: 3600, H4: 14400, D1: 86400,
};

const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

/**
 * Pick a sensible default timeframe from the trade's open→close duration.
 * Shorter trades → smaller TF; longer trades → bigger TF.
 */
function autoTimeframe(trade: Trade): string {
  if (trade.chartTimeframe) return trade.chartTimeframe;
  if (!trade.openTime || !trade.closeTime) return 'M15';
  const durationMs =
    new Date(trade.closeTime).getTime() - new Date(trade.openTime).getTime();
  const mins = durationMs / 60000;
  if (mins <= 10)  return 'M1';
  if (mins <= 60)  return 'M5';
  if (mins <= 240) return 'M15';
  if (mins <= 720) return 'M30';
  if (mins <= 1440 * 2) return 'H1';
  if (mins <= 1440 * 14) return 'H4';
  return 'D1';
}

const getTradeCandlesCacheKey = (tradeId: string) => `jfx_trade_candles_${tradeId}`;

// ─── Status types ─────────────────────────────────────────────────────────────

type Status = 'idle' | 'loading' | 'done' | 'error' | 'no-auth' | 'no-times';

// ─── Component ────────────────────────────────────────────────────────────────

const TradeChartView: React.FC<TradeChartViewProps> = ({
  trade,
  isDarkMode,
  onOpenSettings,
  onSaveCandles,
}) => {
  const defaultTF = autoTimeframe(trade);
  const [timeframe, setTimeframe] = useState<string>(defaultTF);
  const [candlesBefore, setCandlesBefore] = useState(30);
  const [candlesAfter, setCandlesAfter] = useState(15);
  const [candles, setCandles] = useState<Candle[]>(() => {
    if (trade.chartCandles && trade.chartCandles.length >= 2) {
      return trade.chartCandles;
    }
    return [];
  });
  const [status, setStatus] = useState<Status>(() => {
    if (trade.chartCandles && trade.chartCandles.length >= 2) {
      return 'done';
    }
    return 'idle';
  });
  const [isSavedToCloud, setIsSavedToCloud] = useState<boolean>(() => {
    return Boolean(trade.chartCandles && trade.chartCandles.length >= 2);
  });
  const [errorMsg, setErrorMsg] = useState('');
  const [tfMenuOpen, setTfMenuOpen] = useState(false);
  const fetchIdRef = useRef(0); // abort stale fetches

  // ── Fetch from cTrader & Persist ──────────────────────────────────────────

  const fetchCandles = useCallback(async (tf: string, before: number, after: number, force: boolean = false) => {
    // 1. Guard: check existing cloud / saved candles on trade if not forced
    if (!force && trade.chartCandles && trade.chartCandles.length >= 2 && (trade.chartTimeframe === tf || !trade.chartTimeframe)) {
      setCandles(trade.chartCandles);
      setStatus('done');
      setIsSavedToCloud(true);
      return;
    }

    // 2. Guard: check local cache if not forced
    if (!force) {
      try {
        const cachedRaw = localStorage.getItem(getTradeCandlesCacheKey(trade.id));
        if (cachedRaw) {
          const parsed = JSON.parse(cachedRaw);
          if (parsed && Array.isArray(parsed.candles) && parsed.candles.length >= 2 && parsed.timeframe === tf) {
            setCandles(parsed.candles);
            setStatus('done');
            setIsSavedToCloud(true);
            if (!trade.chartCandles || trade.chartCandles.length === 0) {
              onSaveCandles?.(parsed.candles, tf);
            }
            return;
          }
        }
      } catch (e) {
        // Cache read fallback to network fetch
      }
    }

    // Guard: need timestamps
    if (!trade.openTime || !trade.closeTime) {
      setStatus('no-times');
      return;
    }

    // Guard: need auth
    if (!isCtraderAuthenticated()) {
      setStatus('no-auth');
      return;
    }

    const id = ++fetchIdRef.current;
    setStatus('loading');
    setIsSavedToCloud(false);

    try {
      const accounts = await getCtraderAccounts();
      if (!accounts || accounts.length === 0) {
        if (id !== fetchIdRef.current) return;
        setStatus('no-auth');
        return;
      }

      const account = accounts[0];
      const tfSec = TF_SECONDS[tf] ?? 3600;

      const openMs  = new Date(trade.openTime).getTime();
      const closeMs = new Date(trade.closeTime).getTime();
      const fromMs  = openMs  - before * tfSec * 1000;
      const toMs    = closeMs + after  * tfSec * 1000;

      const totalCount = before + after + 50; // generous buffer

      const data = await fetchCtraderCandles(
        account.ctidTraderAccountId,
        trade.pair,
        tf,
        totalCount,
        account.isDemo,
        3,
        fromMs,
        toMs,
      );

      if (id !== fetchIdRef.current) return; // stale, discard

      if (!data || data.length === 0) {
        setStatus('error');
        setErrorMsg('No bars returned for this period.');
        return;
      }

      setCandles(data);
      setStatus('done');
      setIsSavedToCloud(true);

      // Save to local cache
      try {
        localStorage.setItem(
          getTradeCandlesCacheKey(trade.id),
          JSON.stringify({ candles: data, timeframe: tf, updatedAt: Date.now() })
        );
      } catch (e) {
        console.warn('Failed to cache trade candles locally:', e);
      }

      // Persist to Supabase cloud
      if (onSaveCandles) {
        onSaveCandles(data, tf);
      }
    } catch (err: any) {
      if (id !== fetchIdRef.current) return;
      setStatus('error');
      setErrorMsg(err?.message ?? 'Failed to fetch candles.');
    }
  }, [trade, onSaveCandles]);

  // Auto-fetch on mount and when TF / context window changes
  useEffect(() => {
    fetchCandles(timeframe, candlesBefore, candlesAfter, false);
  }, [fetchCandles, timeframe, candlesBefore, candlesAfter]);

  // Recompute auto TF when trade changes (e.g. user navigates between trades)
  useEffect(() => {
    const tf = autoTimeframe(trade);
    setTimeframe(tf);
    if (trade.chartCandles && trade.chartCandles.length >= 2) {
      setCandles(trade.chartCandles);
      setStatus('done');
      setIsSavedToCloud(true);
    }
  }, [trade.id]);

  // ── Render helpers ───────────────────────────────────────────────────────

  const btnBase = `px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all`;
  const btnActive = isDarkMode
    ? 'bg-zinc-800 text-white'
    : 'bg-slate-200 text-slate-900';
  const btnInactive = isDarkMode
    ? 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'
    : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100';

  // ── Overlay panels (non-chart states) ────────────────────────────────────

  const renderOverlay = () => {
    if (status === 'loading') {
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 bg-black/60 backdrop-blur-sm rounded-xl">
          <RefreshCw size={22} className="animate-spin text-zinc-400" />
          <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
            Fetching & Syncing {trade.pair} · {timeframe}
          </span>
        </div>
      );
    }

    if (status === 'no-auth') {
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-10 bg-black/70 backdrop-blur-sm rounded-xl px-6">
          <div className={`p-3 rounded-2xl ${isDarkMode ? 'bg-zinc-900' : 'bg-slate-100'}`}>
            <Wifi size={24} className="text-zinc-500" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-[11px] font-black uppercase tracking-widest text-zinc-300">
              cTrader not connected
            </p>
            <p className="text-[10px] text-zinc-500">
              Connect your account to load and save live candles
            </p>
          </div>
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-black uppercase tracking-widest transition-all active:scale-95"
            >
              <Settings size={12} />
              Open Settings
            </button>
          )}
        </div>
      );
    }

    if (status === 'no-times') {
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 bg-black/70 backdrop-blur-sm rounded-xl px-6">
          <Clock size={22} className="text-zinc-500" />
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 text-center">
            Trade has no open / close timestamps
          </p>
          <p className="text-[9px] text-zinc-600 text-center">
            Edit the trade to add timestamps and enable chart view.
          </p>
        </div>
      );
    }

    if (status === 'error') {
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 bg-black/70 backdrop-blur-sm rounded-xl px-6">
          <AlertTriangle size={22} className="text-rose-500" />
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 text-center">
            {errorMsg || 'Failed to load chart'}
          </p>
          <button
            onClick={() => fetchCandles(timeframe, candlesBefore, candlesAfter, true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[10px] font-black uppercase tracking-widest transition-all active:scale-95"
          >
            <RefreshCw size={12} />
            Retry
          </button>
        </div>
      );
    }

    return null;
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full w-full">
      {/* ── Chart Header ── */}
      <div
        className={`flex items-center justify-between gap-3 px-3 py-2 border-b shrink-0 ${
          isDarkMode ? 'border-zinc-800 bg-black/40' : 'border-slate-100 bg-slate-50'
        }`}
      >
        {/* Left: symbol + direction badge + cloud status */}
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-[10px] font-black uppercase tracking-widest truncate ${isDarkMode ? 'text-zinc-200' : 'text-slate-700'}`}>
            {trade.pair}
          </span>
          <span
            className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${
              trade.direction === 'Long'
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'bg-rose-500/20 text-rose-400'
            }`}
          >
            {trade.direction}
          </span>

          {/* Cloud Synced indicator */}
          {isSavedToCloud && status === 'done' && (
            <span
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/20"
              title="Candlesticks saved in cloud"
            >
              <CloudCheck size={10} />
              Saved
            </span>
          )}
        </div>

        {/* Right: TF picker + context window + force refresh */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Context pills: candles before */}
          <div className={`flex items-center rounded-lg p-0.5 gap-0.5 ${isDarkMode ? 'bg-zinc-900' : 'bg-slate-100'}`}>
            {[15, 30, 50].map((n) => (
              <button
                key={n}
                onClick={() => {
                  setCandlesBefore(n);
                  fetchCandles(timeframe, n, candlesAfter, true);
                }}
                className={`${btnBase} ${candlesBefore === n ? btnActive : btnInactive}`}
                title={`Show ${n} candles before entry`}
              >
                -{n}
              </button>
            ))}
          </div>

          <div className={`w-px h-4 ${isDarkMode ? 'bg-zinc-800' : 'bg-slate-200'}`} />

          {/* Timeframe picker */}
          <div className="relative">
            <button
              onClick={() => setTfMenuOpen((v) => !v)}
              className={`flex items-center gap-1 ${btnBase} ${isDarkMode ? 'bg-zinc-900 text-zinc-200 hover:bg-zinc-800' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
            >
              {timeframe}
              <ChevronDown size={10} />
            </button>
            {tfMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setTfMenuOpen(false)} />
                <div
                  className={`absolute top-full right-0 mt-1 z-50 rounded-xl border shadow-xl overflow-hidden ${
                    isDarkMode ? 'bg-zinc-950 border-zinc-800' : 'bg-white border-slate-200'
                  }`}
                >
                  {TIMEFRAMES.map((tf) => (
                    <button
                      key={tf}
                      onClick={() => {
                        setTimeframe(tf);
                        setTfMenuOpen(false);
                        fetchCandles(tf, candlesBefore, candlesAfter, true);
                      }}
                      className={`block w-full text-left px-4 py-2 text-[10px] font-black uppercase tracking-widest transition-colors ${
                        tf === timeframe
                          ? isDarkMode ? 'bg-zinc-800 text-white' : 'bg-slate-100 text-slate-900'
                          : isDarkMode ? 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                      }`}
                    >
                      {tf}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className={`w-px h-4 ${isDarkMode ? 'bg-zinc-800' : 'bg-slate-200'}`} />

          {/* Force Refresh & Re-sync */}
          <button
            onClick={() => fetchCandles(timeframe, candlesBefore, candlesAfter, true)}
            disabled={status === 'loading'}
            className={`p-1.5 rounded-lg transition-all ${
              status === 'loading'
                ? 'opacity-30 cursor-not-allowed'
                : isDarkMode ? 'hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300' : 'hover:bg-slate-100 text-slate-400 hover:text-slate-600'
            }`}
            title="Refetch and update cloud saved chart"
          >
            <RefreshCw size={13} className={status === 'loading' ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── Chart Canvas Area ── */}
      <div className="relative flex-1 min-h-0">
        {/* Chart */}
        <CustomChart
          data={candles}
          trades={status === 'done' ? [trade] : []}
          drawings={[]}
          isDarkMode={isDarkMode}
          showGrid={true}
          disablePan={false}
        />

        {/* Status overlay (loading / error / no-auth / no-times) */}
        {renderOverlay()}
      </div>
    </div>
  );
};

export default TradeChartView;
