import React, { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw, ChevronDown, AlertTriangle, Clock, Settings, FlaskConical } from 'lucide-react';
import { Trade, Candle } from '../../../types';
import {
  fetchCtraderCandles,
  isAuthenticated as isCtraderAuthenticated,
  getAccounts as getCtraderAccounts,
  getSelectedAccountId,
} from '../../../services/ctraderService';
import CustomChart from '../../CustomChart';
import { Drawing } from '../../backtest/types';

const TradeReplayOverlay = lazy(() => import('../../TradeReplayOverlay'));

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

const REPLAY_DRAWINGS_KEY = 'jfx_backtest_drawings';

const normKeyPart = (v: unknown): string => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Everything drawn in BacktestLab persists globally under
 * `jfx_backtest_drawings`. Mirror its visibility rule: drawings scoped to
 * another symbol/timeframe (syncAllTimeframes === false with a foreign
 * originKey) stay hidden; everything else renders here, READ-ONLY.
 * Index anchors (`logical`) are stripped so points resolve by wall-clock
 * time against THIS candle array (indices differ per dataset).
 */
const readReplayDrawings = (pair: string, timeframe: string): Drawing[] => {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(REPLAY_DRAWINGS_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const homeKey = `${normKeyPart(pair)}_${normKeyPart(timeframe)}`;
  const out: Drawing[] = [];
  for (const d of parsed as any[]) {
    if (!d || typeof d !== 'object') continue;
    if (!d.p1 || !Number.isFinite(Number(d.p1?.time)) || !Number.isFinite(Number(d.p1?.price))) continue;
    if (d.syncAllTimeframes === false) {
      const origin = normKeyPart(d.originKey || '');
      if (!origin || origin !== homeKey) continue;
    }
    const p1 = { time: Number(d.p1.time), price: Number(d.p1.price) };
    const p2 =
      d.p2 && Number.isFinite(Number(d.p2?.time)) && Number.isFinite(Number(d.p2?.price))
        ? { time: Number(d.p2.time), price: Number(d.p2.price) }
        : undefined;
    out.push({ ...d, p1, p2 } as Drawing);
  }
  return out;
};

const SCALE_CANDIDATES = [10, 100, 1000];

/**
 * Candles saved before the trendbar unit fix may be 10x/100x/1000x too large.
 * Detect a clean scale mismatch against the trade's entry price and rescale;
 * correctly-scaled data passes through untouched.
 */
const normalizeCandleScale = (candles: Candle[], trade: Trade): Candle[] => {
  const entry = Number(trade.entryPrice);
  if (!candles || candles.length < 2 || !Number.isFinite(entry) || entry <= 0) return candles;
  const closes = candles
    .map(c => Number(c.close))
    .filter(v => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  if (closes.length === 0) return candles;
  const median = closes[Math.floor(closes.length / 2)];
  const ratio = median / entry;
  const factor = SCALE_CANDIDATES.find(s => Math.abs(ratio - s) / s <= 0.02);
  if (!factor) return candles;
  return candles.map(c => ({
    ...c,
    open: c.open / factor,
    high: c.high / factor,
    low: c.low / factor,
    close: c.close / factor,
  }));
};

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
  const [candlesBefore, setCandlesBefore] = useState(600);
  const [candlesAfter, setCandlesAfter] = useState(200);
  const [candles, setCandles] = useState<Candle[]>(() => {
    if (trade.chartCandles && trade.chartCandles.length >= 2) {
      return normalizeCandleScale(trade.chartCandles, trade);
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
  const [showReplayOverlay, setShowReplayOverlay] = useState(false);
  // Replay drawings overlay (read-only — no selection, drag, or toolbar here).
  const [replayDrawings, setReplayDrawings] = useState<Drawing[]>(() => readReplayDrawings(trade.pair, timeframe));
  useEffect(() => {
    const refresh = () => setReplayDrawings(readReplayDrawings(trade.pair, timeframe));
    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [trade.pair, timeframe]);
  const tfButtonRef = useRef<HTMLButtonElement>(null);
  const [tfMenuPos, setTfMenuPos] = useState<{ top: number; right: number } | null>(null);
  const fetchIdRef = useRef(0); // abort stale fetches
  // Persist-once guard: onSaveCandles triggers App.setTrades → new trade
  // object → fetchCandles recreated → effect refires. Without this, every
  // chart open fires a heavy full-row updateTrade write of chart_candles.
  const savedSigRef = useRef<string | null>(null);
  const updateTfMenuPos = useCallback(() => {
    const el = tfButtonRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setTfMenuPos({
      top: r.bottom + 6,
      right: Math.max(8, window.innerWidth - r.right),
    });
  }, []);

  const toggleTfMenu = useCallback(() => {
    setTfMenuOpen((v) => {
      if (!v) {
        // Measure on next frame so the button rect is current (after any scroll).
        requestAnimationFrame(() => updateTfMenuPos());
      }
      return !v;
    });
  }, [updateTfMenuPos]);

  // Keep the portaled menu anchored while open; close on Escape.
  useEffect(() => {
    if (!tfMenuOpen) return;
    updateTfMenuPos();
    const onReposition = () => updateTfMenuPos();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTfMenuOpen(false);
    };
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [tfMenuOpen, updateTfMenuPos]);
  const persistOnce = (list: Candle[], tf: string) => {
    const sig = `${trade.id}:${tf}:${list.length}`;
    if (savedSigRef.current === sig) return;
    savedSigRef.current = sig;
    onSaveCandles?.(list, tf);
  };

  // ── Marker resolvability (mirrors CustomChart placement) ──────────────
  // Surfaces WHY arrows may be missing instead of failing silently: bad or
  // missing timestamps, or fill prices far outside the candle range
  // (e.g. wrong per-symbol scaling from the feed).
  const markerInfo = useMemo(() => {
    if (candles.length < 2) return null;
    const parseSec = (v: unknown): number | null => {
      if (v === null || v === undefined) return null;
      if (typeof v === 'number') {
        if (!Number.isFinite(v) || v <= 0) return null;
        return v > 1e11 ? Math.floor(v / 1000) : Math.floor(v);
      }
      if (typeof v === 'string') {
        const t = v.trim();
        if (!t) return null;
        const ms = Date.parse(t);
        if (Number.isFinite(ms)) return Math.floor(ms / 1000);
        const alt = Date.parse(t.replace(/\./g, '/'));
        return Number.isFinite(alt) ? Math.floor(alt / 1000) : null;
      }
      return null;
    };
    const closest = (sec: number | null): number => {
      if (sec === null) return -1;
      let best = -1;
      let min = Infinity;
      for (let i = 0; i < candles.length; i++) {
        const d = Math.abs(candles[i].time - sec);
        if (d < min) { min = d; best = i; }
      }
      return best;
    };
    const entryIdx = closest(parseSec(trade.openTime));
    const exitIdx = closest(parseSec(trade.closeTime));
    const hasEntryPrice = Number.isFinite(Number(trade.entryPrice)) && Number(trade.entryPrice) > 0;
    const hasExitPrice = Number.isFinite(Number(trade.exitPrice)) && Number(trade.exitPrice) > 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of candles) {
      if (Number.isFinite(c.low) && c.low > 0 && c.low < lo) lo = c.low;
      if (Number.isFinite(c.high) && c.high > 0 && c.high > hi) hi = c.high;
    }
    const span = hi - lo;
    const offScale = (p: number) =>
      Number.isFinite(p) && p > 0 && Number.isFinite(lo) && Number.isFinite(span) && span > 0 &&
      (p < lo - span * 0.25 || p > hi + span * 0.25);
    const entryOff = hasEntryPrice && offScale(Number(trade.entryPrice));
    const exitOff = hasExitPrice && offScale(Number(trade.exitPrice));

    if (entryIdx < 0 && exitIdx < 0) {
      return {
        ok: false,
        label: 'No timestamps',
        detail: `Trade has no usable open/close time (openTime=${String(trade.openTime)}, closeTime=${String(trade.closeTime)}). Add timestamps to place markers.`,
      };
    }
    const problems: string[] = [];
    if (entryIdx < 0) problems.push('entry: no usable time');
    else if (entryOff) problems.push(`entry price ${trade.entryPrice} is far outside candle range ${lo}–${hi}`);
    if (exitIdx < 0) problems.push('exit: no usable time');
    else if (exitOff) problems.push(`exit price ${trade.exitPrice} is far outside candle range ${lo}–${hi}`);
    if (problems.length === 0) {
      return {
        ok: true,
        label: 'Entry ✓ · Exit ✓',
        detail: `Entry bar ${entryIdx}, exit bar ${exitIdx} of ${candles.length}. If arrows are still hidden, pan left / zoom out — they may be outside the current view.`,
      };
    }
    return { ok: false, label: `⚠ ${problems.join(' · ')}`, detail: problems.join('; ') };
  }, [candles, trade.openTime, trade.closeTime, trade.entryPrice, trade.exitPrice]);

  useEffect(() => {
    if (status === 'done' && markerInfo) {
      console.debug('[TradeChartView] marker state', {
        tradeId: trade.id,
        pair: trade.pair,
        openTime: trade.openTime,
        closeTime: trade.closeTime,
        entryPrice: trade.entryPrice,
        exitPrice: trade.exitPrice,
        candles: candles.length,
        ...markerInfo,
      });
    }
  }, [status, markerInfo, candles.length, trade.id, trade.pair, trade.openTime, trade.closeTime, trade.entryPrice, trade.exitPrice]);

  // ── Fetch from cTrader & Persist ──────────────────────────────────────────

  const fetchCandles = useCallback(async (tf: string, before: number, after: number, force: boolean = false) => {
    const minRequiredCount = Math.max(before + after, 700);

    // 1. Guard: check existing cloud / saved candles on trade if not forced and sufficiently deep
    if (!force && trade.chartCandles && trade.chartCandles.length >= minRequiredCount && (trade.chartTimeframe === tf || !trade.chartTimeframe)) {
      setCandles(normalizeCandleScale(trade.chartCandles, trade));
      setStatus('done');
      setIsSavedToCloud(true);
      return;
    }

    // Historical chart data is deliberately omitted from the journal list
    // query. Load it only when this chart is opened.
    if (!force && (!trade.chartCandles || trade.chartCandles.length < minRequiredCount)) {
      try {
        const { dataService } = await import('../../../services/dataService');
        const stored = await dataService.getTradeChartCandles(trade.id);
        if (stored?.candles && stored.candles.length >= minRequiredCount && (stored.timeframe === tf || !stored.timeframe)) {
          setCandles(normalizeCandleScale(stored.candles, trade));
          setStatus('done');
          setIsSavedToCloud(true);
          return;
        }
      } catch (error) {
        console.warn('Failed to load saved trade candles:', error);
      }
    }

    // 2. Guard: check local cache if not forced and sufficiently deep
    if (!force) {
      try {
        const cachedRaw = localStorage.getItem(getTradeCandlesCacheKey(trade.id));
        if (cachedRaw) {
          const parsed = JSON.parse(cachedRaw);
          if (parsed && Array.isArray(parsed.candles) && parsed.candles.length >= minRequiredCount && parsed.timeframe === tf) {
            const cachedCandles = normalizeCandleScale(parsed.candles, trade);
            setCandles(cachedCandles);
            setStatus('done');
            setIsSavedToCloud(true);
            if (!trade.chartCandles || trade.chartCandles.length === 0) {
              persistOnce(cachedCandles, tf);
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

      const savedAccountId = getSelectedAccountId();
      const account = accounts.find(a => a.ctidTraderAccountId === savedAccountId) || accounts[0];
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

      const freshCandles = normalizeCandleScale(data, trade);
      setCandles(freshCandles);
      setStatus('done');
      setIsSavedToCloud(true);

      // Save to local cache
      try {
        localStorage.setItem(
          getTradeCandlesCacheKey(trade.id),
          JSON.stringify({ candles: freshCandles, timeframe: tf, updatedAt: Date.now() })
        );
      } catch (e) {
        console.warn('Failed to cache trade candles locally:', e);
      }

      // Persist to Supabase cloud (once per trade+tf+size — see guard)
      persistOnce(freshCandles, tf);
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
      setCandles(normalizeCandleScale(trade.chartCandles, trade));
      setStatus('done');
      setIsSavedToCloud(true);
    }
  }, [trade.id]);

  // ── Render helpers ───────────────────────────────────────────────────────

  const btnBase = `px-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-[10px] font-black uppercase tracking-widest transition-all shrink-0`;
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
            <img src="/icon3.jpeg" alt="cTrader" className="w-6 h-6 object-contain" />
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
      {/* NOTE: keep overflow-visible (never overflow-x-auto) so the portaled
          timeframe menu is never clipped by this bar or the rounded
          overflow-hidden card in Journal.tsx. Pills scroll internally. */}
      <div
        className={`flex items-center justify-between gap-2 px-3 py-2 border-b shrink-0 overflow-visible relative z-30 ${
          isDarkMode ? 'border-zinc-800 bg-black/40' : 'border-slate-100 bg-slate-50'
        }`}
      >
        {/* Left: Replay Trade button */}
        <div className="flex items-center shrink-0">
          <button
            onClick={() => setShowReplayOverlay(true)}
            disabled={status !== 'done' || candles.length < 2}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all active:scale-95 shrink-0 whitespace-nowrap min-h-[44px] ${
              status === 'done' && candles.length >= 2
                ? isDarkMode
                  ? 'bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800/80'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200'
                : isDarkMode
                  ? 'bg-zinc-900/50 text-zinc-600 cursor-not-allowed border border-zinc-800/30'
                  : 'bg-slate-100/50 text-slate-400 cursor-not-allowed border border-slate-200/50'
            }`}
            title="Open trade in replay mode for analysis"
          >
            <FlaskConical size={16} className="shrink-0 text-indigo-400" />
            <span className="leading-none whitespace-nowrap">Replay Trade</span>
          </button>
        </div>

        {/* Right: TF picker + context window + force refresh */}
        <div className="flex items-center gap-1.5 shrink-0 ml-auto min-w-0">
          {/* Context pills: candles before (scrolls internally so TF stays visible) */}
          <div className={`flex items-center rounded-lg p-0.5 gap-0.5 overflow-x-auto no-scrollbar max-w-[34vw] sm:max-w-none min-w-0 ${isDarkMode ? 'bg-zinc-900' : 'bg-slate-100'}`}>
            {[500, 600, 800].map((n) => (
              <button
                key={n}
                onClick={() => {
                  setCandlesBefore(n);
                  fetchCandles(timeframe, n, 200, true);
                }}
                className={`${btnBase} ${candlesBefore === n ? btnActive : btnInactive}`}
                title={`Show ${n} candles before entry`}
              >
                -{n}
              </button>
            ))}
          </div>

          <div className={`w-px h-4 shrink-0 ${isDarkMode ? 'bg-zinc-800' : 'bg-slate-200'}`} />

          {/* Timeframe picker — menu is portaled to document.body so no
              overflow-hidden / overflow-x-auto ancestor can clip it. */}
          <div className="relative shrink-0">
            <button
              ref={tfButtonRef}
              type="button"
              onClick={toggleTfMenu}
              aria-haspopup="menu"
              aria-expanded={tfMenuOpen}
              className={`flex items-center gap-1 ${btnBase} ${isDarkMode ? 'bg-zinc-900 text-zinc-200 hover:bg-zinc-800' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
              title="Switch timeframe"
            >
              {timeframe}
              <ChevronDown size={12} />
            </button>
            {tfMenuOpen && typeof document !== 'undefined' && createPortal(
              <>
                {/* Above the trade detail sheet (z-300): the menu must paint over it, not behind it. */}
                <div className="fixed inset-0 z-[390]" onClick={() => setTfMenuOpen(false)} aria-hidden />
                <div
                  role="menu"
                  aria-label="Switch timeframe"
                  style={tfMenuPos ? { top: tfMenuPos.top, right: tfMenuPos.right } : undefined}
                  className={`fixed z-[400] rounded-xl border shadow-2xl overflow-hidden backdrop-blur-xl animate-sheet-fade origin-top min-w-[148px] ${
                    isDarkMode ? 'bg-zinc-950/95 border-white/10' : 'bg-white border-slate-200'
                  }`}
                >
                  {TIMEFRAMES.map((tf) => (
                    <button
                      key={tf}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setTimeframe(tf);
                        setTfMenuOpen(false);
                        fetchCandles(tf, candlesBefore, candlesAfter, true);
                      }}
                      className={`flex w-full items-center justify-between text-left px-4 min-h-[44px] text-[11px] font-black uppercase tracking-widest transition-colors ${
                        tf === timeframe
                          ? isDarkMode ? 'bg-zinc-800 text-white' : 'bg-slate-100 text-slate-900'
                          : isDarkMode ? 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                      }`}
                    >
                      {tf}
                    </button>
                  ))}
                </div>
              </>,
              document.body
            )}
          </div>

          <div className={`w-px h-4 shrink-0 ${isDarkMode ? 'bg-zinc-800' : 'bg-slate-200'}`} />

          {/* Force Refresh & Re-sync */}
          <button
            onClick={() => fetchCandles(timeframe, candlesBefore, candlesAfter, true)}
            disabled={status === 'loading'}
            className={`flex items-center justify-center min-w-[44px] min-h-[44px] p-1.5 rounded-lg transition-all shrink-0 ${
              status === 'loading'
                ? 'opacity-30 cursor-not-allowed'
                : isDarkMode ? 'hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300' : 'hover:bg-slate-100 text-slate-400 hover:text-slate-600'
            }`}
            title="Refetch and update cloud saved chart"
            aria-label="Refetch chart"
          >
            <RefreshCw size={14} className={status === 'loading' ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── Chart Canvas Area ── */}
      <div className="relative flex-1 min-h-0">
        {/* Chart */}
        <CustomChart
          data={candles}
          trades={status === 'done' ? [trade] : []}
          drawings={replayDrawings}
          isDarkMode={isDarkMode}
          showGrid={true}
          disablePan={false}
          tradingView
          autoFitTrades
          symbol={trade.pair}
          timeframe={timeframe}
        />

        {/* Status overlay (loading / error / no-auth / no-times) */}
        {renderOverlay()}
      </div>

      {/* Fullscreen Replay Trade overlay */}
      {showReplayOverlay && (
        <Suspense fallback={null}>
          <TradeReplayOverlay
            trade={trade}
            candles={candles}
            timeframe={timeframe}
            isDarkMode={isDarkMode}
            onClose={() => setShowReplayOverlay(false)}
            onTimeframeChange={(newTf) => {
              setTimeframe(newTf);
              fetchCandles(newTf, candlesBefore, candlesAfter, true);
            }}
            isFetchingTimeframe={status === 'loading'}
          />
        </Suspense>
      )}
    </div>
  );
};

export default TradeChartView;
