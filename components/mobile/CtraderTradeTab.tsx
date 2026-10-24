import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Lock, Minus, Plus, RefreshCw } from 'lucide-react';
import { useToast } from '../ui/Toast';
import { haptic } from '../../lib/haptics';
import { useCtraderSymbols, type CtraderQuoteSymbol } from '../../hooks/useCtraderSymbols';
import type { TradingEvent } from '../../lib/tradingNotifications';
import {
  bumpLockStat,
  countOpensToday,
  dayKeyInTz,
  evaluateLocks,
  isRuleActive,
  normalizePortfolioLocks,
  readPortfolioLocks,
  writePortfolioLocks,
} from '../../lib/tradingLocks';

interface CtraderTradeTabProps {
  /** Linked/selected cTrader account id (string from localStorage / portfolio link). */
  ctidAccountId?: string | null;
  isDemoMode?: boolean;
  onGoConnect?: () => void;
  /** Shared symbol list (from useCtraderSymbols). Falls back to own fetch when omitted. */
  symbols?: CtraderQuoteSymbol[];
  /** Resolved demo/live env matching `symbols`. Falls back to own resolve when omitted. */
  isDemo?: boolean;
  isLoadingSymbols?: boolean;
  symbolsError?: string | null;
  /** Controlled selection (Quotes picker). Falls back to internal state when omitted. */
  symbolId?: number | null;
  onSymbolChange?: (id: number | null) => void;
  onRefreshSymbols?: () => void;
  /** Compact chrome for embedding in the full-screen detail page (no nav offset). */
  compact?: boolean;
  /** Portfolio scope for trading locks (per-portfolio rules). */
  portfolioId?: string | null;
  timezone?: string;
  /** Desktop notification bridge. Mobile omits it and keeps its current toasts. */
  onTradingEvent?: (event: TradingEvent) => void;
}

const VOLUME_STEPS: { delta: number; label: string }[] = [
  { delta: -0.5, label: '-0.5' },
  { delta: -0.1, label: '-0.1' },
  { delta: -0.01, label: '-0.01' },
  { delta: 0.01, label: '+0.01' },
  { delta: 0.1, label: '+0.1' },
  { delta: 0.5, label: '+0.5' },
];

const formatPrice = (value: number | null | undefined, digits: number): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  // Spot wire values are scaled integers — normalize by the symbol's digits.
  const human = value / Math.pow(10, digits);
  if (!Number.isFinite(human)) return '—';
  return human.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

const digitsFor = (symbol?: CtraderQuoteSymbol | null): number | null => {
  const d = Number(symbol?.digits);
  if (Number.isFinite(d) && d >= 0 && d <= 8) return d;
  // No known digits: return null so prices render as dashes instead of
  // garbage (matches fetchCtraderCandles: JPY → 3, else 5 once resolved).
  const name = (symbol?.symbolName || '').toUpperCase().replace('/', '');
  if (!name) return null;
  if (name.endsWith('JPY')) return 3;
  if (name.includes('XAU') || name.includes('GOLD')) return 2;
  return 5;
};

export const CtraderTradeTab: React.FC<CtraderTradeTabProps> = ({
  ctidAccountId,
  isDemoMode = false,
  onGoConnect,
  symbols: symbolsProp,
  isDemo: isDemoProp,
  isLoadingSymbols: isLoadingProp,
  symbolsError: symbolsErrorProp,
  symbolId: symbolIdProp,
  onSymbolChange,
  onRefreshSymbols,
  compact = false,
  portfolioId,
  timezone,
  onTradingEvent,
}) => {
  const { addToast } = useToast();
  const numericAccountId = useMemo(() => {
    const n = Number(ctidAccountId);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [ctidAccountId]);

  // Shared list when provided; otherwise fall back to own fetch.
  const fallback = useCtraderSymbols(symbolsProp === undefined ? ctidAccountId : null);
  const symbols = symbolsProp ?? fallback.symbols;
  const isDemo = isDemoProp ?? fallback.isDemo;
  const isLoadingSymbols = isLoadingProp ?? fallback.isLoading;
  const symbolsError = symbolsErrorProp ?? fallback.error;
  const refreshSymbols = onRefreshSymbols ?? fallback.reload;

  // Controlled selection when provided; otherwise internal state.
  const [internalSymbolId, setInternalSymbolId] = useState<number | null>(null);
  const symbolId = symbolIdProp !== undefined ? symbolIdProp : internalSymbolId;
  const setSymbolId = useCallback(
    (id: number | null) => {
      if (onSymbolChange) onSymbolChange(id);
      else setInternalSymbolId(id);
    },
    [onSymbolChange]
  );
  const [bid, setBid] = useState<number | null>(null);
  const [ask, setAsk] = useState<number | null>(null);
  const [volume, setVolume] = useState(0.01);
  const [stopLoss, setStopLoss] = useState<string>('');
  const [takeProfit, setTakeProfit] = useState<string>('');
  const [isPlacing, setIsPlacing] = useState<null | 'buy' | 'sell'>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const activeSymbol = useMemo(
    () => symbols.find((s) => Number(s.symbolId) === Number(symbolId)) ?? null,
    [symbols, symbolId]
  );
  const resolvedDigits = digitsFor(activeSymbol);
  // Stepping falls back to 5-digit math; DISPLAY shows dashes until the
  // real digits resolve so wire integers never render as garbage prices.
  const digits = resolvedDigits ?? 5;
  const priceStep = useMemo(() => 10 / Math.pow(10, digits), [digits]);

  // Default to the first symbol when uncontrolled and nothing selected yet.
  useEffect(() => {
    if (symbolIdProp !== undefined) return;
    if (internalSymbolId !== null) return;
    if (symbols.length === 0) return;
    setInternalSymbolId(symbols[0].symbolId);
  }, [symbolIdProp, internalSymbolId, symbols]);

  // Clear selection when the account disconnects.
  useEffect(() => {
    if (numericAccountId === null) setInternalSymbolId(null);
  }, [numericAccountId]);

  // Trading locks for this portfolio. Cloud is the source of truth; the
  // local cache is the fallback and the newest updatedAt wins the merge.
  const [locks, setLocks] = useState(() => readPortfolioLocks(portfolioId));
  useEffect(() => {
    let alive = true;
    setLocks(readPortfolioLocks(portfolioId));
    if (!portfolioId) {
      return () => {
        alive = false;
      };
    }
    void (async () => {
      try {
        const m = await import('../../services/dataService');
        const remote = await m.dataService.loadPortfolioLocks(portfolioId);
        if (!alive || !remote) return;
        const currentLocal = readPortfolioLocks(portfolioId);
        const remoteAt = Date.parse(remote.updatedAt || '') || 0;
        const localAt = Date.parse(currentLocal.updatedAt || '') || 0;
        if (remoteAt > localAt) {
          const normalized = normalizePortfolioLocks(remote);
          writePortfolioLocks(portfolioId, normalized);
          setLocks(normalized);
        }
      } catch {
        // Cloud unavailable: keep the local cache.
      }
    })();
    return () => {
      alive = false;
    };
  }, [portfolioId]);

  // Fills opened today (account scope) for the max-trades rule.
  // null = unknown; never treat a failed count as zero.
  const [fillsToday, setFillsToday] = useState<number | null>(null);
  const refreshFills = useCallback(async () => {
    if (numericAccountId === null) {
      setFillsToday(null);
      return;
    }
    const n = await countOpensToday(numericAccountId, isDemo, timezone);
    setFillsToday(n);
  }, [numericAccountId, isDemo, timezone]);
  useEffect(() => {
    void refreshFills();
  }, [refreshFills]);

  // Current selection against the locks (drives button lock states + banner).
  const lockVerdict = useMemo(
    () => evaluateLocks(locks, { symbolId, volumeLots: volume, fillsToday, timezone }),
    [locks, symbolId, volume, fillsToday, timezone]
  );
  const anyLockActive =
    isRuleActive(locks.pairWhitelist) || isRuleActive(locks.maxTrades) || isRuleActive(locks.lotGuard);

  // Live spots for the selected symbol via the shared refcounted bus —
  // a co-mounted screen (positions, chart) never loses its feed to our
  // unmount cleanup, and vice versa.
  useEffect(() => {
    if (numericAccountId === null || symbolId === null) return;
    let alive = true;
    let release: (() => void) | null = null;
    const target = Number(symbolId);
    void (async () => {
      try {
        const { acquireSpot } = await import('../../lib/spotBus');
        if (!alive) return;
        const handle = await acquireSpot(numericAccountId, isDemo, target, ({ bid: bRaw, ask: aRaw }) => {
          if (!alive) return;
          if (bRaw !== undefined && bRaw !== null && bRaw !== '') {
            const b = Number(bRaw);
            if (Number.isFinite(b)) setBid(b);
          }
          if (aRaw !== undefined && aRaw !== null && aRaw !== '') {
            const a = Number(aRaw);
            if (Number.isFinite(a)) setAsk(a);
          }
        });
        if (!alive) handle.release();
        else release = handle.release;
      } catch {
        /* offline / expired session: prices stay dashed */
      }
    })();
    setBid(null);
    setAsk(null);
    return () => {
      alive = false;
      if (release) release();
    };
  }, [numericAccountId, symbolId, isDemo]);

  const adjustVolume = useCallback((delta: number) => {
    try {
      haptic.selection();
    } catch {}
    setVolume((prev) => {
      const next = Math.round((prev + delta) * 1000) / 1000;
      if (next < 0.01) return 0.01;
      if (next > 100) return 100;
      return next;
    });
  }, []);

  const stepPrice = useCallback(
    (setter: React.Dispatch<React.SetStateAction<string>>, dir: 1 | -1, base: number | null) => {
      try {
        haptic.selection();
      } catch {}
      setter((prev) => {
        const current = prev === '' ? base : Number(prev);
        const anchor = Number.isFinite(current as number) ? (current as number) : base;
        if (anchor === null || anchor === undefined || !Number.isFinite(anchor)) return prev;
        const next = anchor + dir * priceStep;
        return next.toFixed(digits);
      });
    },
    [digits, priceStep]
  );

  const placeOrder = useCallback(
    async (side: 'buy' | 'sell') => {
      if (numericAccountId === null || symbolId === null) return;
      if (isDemoMode) {
        addToast({ type: 'info', title: 'Demo mode', message: 'Live cTrader orders are disabled in demo mode.', duration: 4000 });
        return;
      }
      // Trading locks gate NEW risk only — closes and SL/TP edits never pass here.
      const verdict = evaluateLocks(locks, { symbolId, volumeLots: volume, fillsToday, timezone });
      if (verdict.allowed === false) {
        bumpLockStat(portfolioId, dayKeyInTz(Date.now(), timezone), 'blocks');
        setLastResult(`Locked: ${verdict.message}`);
        addToast({
          type: 'error',
          title: 'Blocked by trading lock',
          message: verdict.reason === 'count_unavailable' ? verdict.message : `${verdict.message} Adjust in Rules & Checklists.`,
          duration: 5000,
        });
        onTradingEvent?.({
          kind: 'error',
          message: verdict.message,
          errorCode: 'locked_by_rule',
          alreadyToasted: true,
        });
        return;
      }
      setIsPlacing(side);
      setLastResult(null);
      try {
        try {
          haptic.selection();
        } catch {}
        const svc = await import('../../services/ctraderService');
        const sl = stopLoss.trim() === '' ? undefined : Number(stopLoss);
        const tp = takeProfit.trim() === '' ? undefined : Number(takeProfit);
        if (sl !== undefined && !Number.isFinite(sl)) throw new Error('Stop loss must be a valid price.');
        if (tp !== undefined && !Number.isFinite(tp)) throw new Error('Take profit must be a valid price.');
        await svc.createNewOrder(numericAccountId, Number(symbolId), side, volume, {
          stopLoss: sl,
          takeProfit: tp,
          isDemo,
          comment: 'jfx-mobile',
        });
        const msg = `${side === 'buy' ? 'Buy' : 'Sell'} ${volume.toFixed(2)} ${activeSymbol?.symbolName ?? ''} placed`;
        setLastResult(msg);
        addToast({ type: 'success', title: 'Order sent', message: msg, duration: 4000 });
        onTradingEvent?.({ kind: 'order_placed', message: msg, alreadyToasted: true });
        void refreshFills();
      } catch (e: any) {
        const msg = e?.message || 'Order failed. Check connection and retry.';
        setLastResult(msg);
        addToast({ type: 'error', title: 'Order failed', message: msg, duration: 5000 });
        onTradingEvent?.({
          kind: 'error',
          message: msg,
          errorCode: e?.code,
          status: e?.status,
          alreadyToasted: true,
        });
      } finally {
        setIsPlacing(null);
      }
    },
    [numericAccountId, symbolId, volume, stopLoss, takeProfit, isDemo, isDemoMode, activeSymbol, addToast, onTradingEvent, locks, fillsToday, portfolioId, timezone, refreshFills]
  );

  if (numericAccountId === null) {
    return (
      <div className="px-4 pt-4 pb-28">
        <div className="p-5 rounded-2xl border bg-[#0a0a0a] border-zinc-800/80 text-center">
          <p className="text-[15px] font-bold text-white">No cTrader account linked</p>
          <p className="text-[12px] text-zinc-500 mt-1">Link this portfolio to trade live from here.</p>
          <button
            onClick={() => {
              try {
                haptic.selection();
              } catch {}
              onGoConnect?.();
            }}
            className="mt-3 h-11 px-5 rounded-xl bg-[#FF4F01] text-white text-xs font-bold active:scale-95 transition-all"
          >
            Connect cTrader
          </button>
        </div>
      </div>
    );
  }

  const midRaw = bid ?? ask;
  // Human-price seed for the SL/TP steppers (null until digits resolve).
  const mid = resolvedDigits === null || midRaw === null || midRaw === undefined ? null : midRaw / Math.pow(10, resolvedDigits);

  return (
    <div className={`px-4 pt-3 bg-[#000000] ${compact ? 'pb-4' : 'pb-28'}`}>
      {/* Symbol header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor="ctrader-trade-symbol" className="sr-only">
            Trading symbol
          </label>
          <select
            id="ctrader-trade-symbol"
            value={symbolId ?? ''}
            onChange={(e) => setSymbolId(e.target.value === '' ? null : Number(e.target.value))}
            className="w-full bg-transparent text-[20px] font-black tracking-tight leading-tight text-white truncate outline-none"
          >
            {symbols.map((s) => (
              <option key={s.symbolId} value={s.symbolId} className="bg-black text-white">
                {s.symbolName}
              </option>
            ))}
          </select>
          <p className="text-[12px] font-medium text-zinc-500 truncate mt-0.5">
            {isLoadingSymbols
              ? 'Loading symbols…'
              : activeSymbol?.description || `${activeSymbol?.symbolName ?? 'Select a symbol'}${isDemo ? ' · Demo' : ' · Live'}`}
          </p>
        </div>
        <button
          onClick={() => {
            try {
              haptic.selection();
            } catch {}
            refreshSymbols();
          }}
          aria-label="Refresh symbols"
          className="p-2 rounded-xl text-zinc-400 active:scale-95 active:bg-zinc-900 shrink-0"
        >
          <RefreshCw size={20} />
        </button>
      </div>

      {symbolsError && <p className="mt-2 text-[12px] font-medium text-rose-400">{symbolsError}</p>}

      {/* Market Execution title */}
      <div className="mt-4">
        <p className="text-center text-[17px] font-medium text-white">Market Execution</p>
        <div className="mt-1 h-px bg-zinc-800 relative">
          <div className="absolute right-0 -top-[5px] w-0 h-0 border-l-[10px] border-l-transparent border-b-[6px] border-b-zinc-800" />
        </div>
      </div>

      {/* Volume ladder */}
      <div className="mt-3 border-b border-zinc-800/80 pb-3">
        <div className="flex items-center justify-between gap-1">
          {VOLUME_STEPS.slice(0, 3).map((s) => (
            <button
              key={s.label}
              onClick={() => adjustVolume(s.delta)}
              className="flex-1 py-2 text-[15px] font-medium text-zinc-400 active:scale-95 active:text-white touch-manipulation"
            >
              {s.label}
            </button>
          ))}
          <span className="flex-1 text-center py-2 text-[19px] font-black text-white tabular-nums">{volume.toFixed(2)}</span>
          {VOLUME_STEPS.slice(3).map((s) => (
            <button
              key={s.label}
              onClick={() => adjustVolume(s.delta)}
              className="flex-1 py-2 text-[15px] font-medium text-[#5b8def] active:scale-95 touch-manipulation"
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Bid / Ask */}
      <div className="mt-3 flex items-center justify-center gap-10">
        <span className="text-[26px] font-black tabular-nums text-[#e5484d]">{resolvedDigits === null ? '—' : formatPrice(bid, resolvedDigits)}</span>
        <span className="text-[26px] font-black tabular-nums text-[#e5484d]">{resolvedDigits === null ? '—' : formatPrice(ask, resolvedDigits)}</span>
      </div>

      {/* SL / TP steppers */}
      <div className="mt-4 flex items-center justify-between">
        <button
          onClick={() => stepPrice(setStopLoss, -1, mid)}
          aria-label="Decrease stop loss"
          className="w-10 h-10 flex items-center justify-center text-zinc-400 active:scale-95 text-[22px] font-light touch-manipulation"
        >
          <Minus size={18} />
        </button>
        <button
          onClick={() => {
            const el = document.getElementById('ctrader-sl-input');
            el?.focus();
          }}
          className="text-[16px] font-medium text-zinc-400 tracking-wide"
        >
          SL <span className="text-zinc-200 tabular-nums ml-1">{stopLoss === '' ? '' : stopLoss}</span>
        </button>
        <button
          onClick={() => stepPrice(setStopLoss, 1, mid)}
          aria-label="Increase stop loss"
          className="w-10 h-10 flex items-center justify-center text-[#5b8def] active:scale-95 text-[22px] font-light touch-manipulation"
        >
          <Plus size={18} />
        </button>
        <button
          onClick={() => stepPrice(setTakeProfit, -1, mid)}
          aria-label="Decrease take profit"
          className="w-10 h-10 flex items-center justify-center text-zinc-400 active:scale-95 text-[22px] font-light touch-manipulation"
        >
          <Minus size={18} />
        </button>
        <button
          onClick={() => {
            const el = document.getElementById('ctrader-tp-input');
            el?.focus();
          }}
          className="text-[16px] font-medium text-zinc-400 tracking-wide"
        >
          TP <span className="text-zinc-200 tabular-nums ml-1">{takeProfit === '' ? '' : takeProfit}</span>
        </button>
        <button
          onClick={() => stepPrice(setTakeProfit, 1, mid)}
          aria-label="Increase take profit"
          className="w-10 h-10 flex items-center justify-center text-[#5b8def] active:scale-95 text-[22px] font-light touch-manipulation"
        >
          <Plus size={18} />
        </button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="ctrader-sl-input" className="sr-only">
            Stop loss price
          </label>
          <input
            id="ctrader-sl-input"
            name="stopLoss"
            inputMode="decimal"
            placeholder="SL price (optional)"
            value={stopLoss}
            onChange={(e) => setStopLoss(e.target.value.replace(/[^0-9.]/g, ''))}
            className="w-full h-11 rounded-lg border bg-[#000000] border-[#27272a] px-3 text-[13px] tabular-nums text-white placeholder:text-zinc-600 outline-none focus:border-[#FF4F01]"
          />
        </div>
        <div>
          <label htmlFor="ctrader-tp-input" className="sr-only">
            Take profit price
          </label>
          <input
            id="ctrader-tp-input"
            name="takeProfit"
            inputMode="decimal"
            placeholder="TP price (optional)"
            value={takeProfit}
            onChange={(e) => setTakeProfit(e.target.value.replace(/[^0-9.]/g, ''))}
            className="w-full h-11 rounded-lg border bg-[#000000] border-[#27272a] px-3 text-[13px] tabular-nums text-white placeholder:text-zinc-600 outline-none focus:border-[#FF4F01]"
          />
        </div>
      </div>

      {/* Warning */}
      <p className="mt-6 text-center text-[13px] leading-relaxed text-zinc-400 px-2">
        Attention! The trade will be executed at market conditions, difference with requested price may be significant!
      </p>

      {lastResult && <p className="mt-3 text-center text-[12px] font-medium text-zinc-400 px-4">{lastResult}</p>}

      {lockVerdict.allowed === false && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2.5">
          <Lock size={14} className="text-amber-300 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold text-amber-200 leading-snug">
              {lockVerdict.reason === 'count_unavailable'
                ? lockVerdict.message
                : `Locked: ${lockVerdict.message} Adjust in Rules & Checklists.`}
            </p>
            {lockVerdict.reason === 'count_unavailable' && (
              <button
                type="button"
                onClick={() => void refreshFills()}
                className="mt-1.5 text-[11px] font-black text-amber-200 underline active:scale-95"
              >
                Retry
              </button>
            )}
          </div>
        </div>
      )}

      {/* SELL / BUY */}
      <div className="mt-4 grid grid-cols-2 divide-x divide-zinc-800">
        <button
          onClick={() => void placeOrder('sell')}
          disabled={isPlacing !== null || symbolId === null || !lockVerdict.allowed}
          className="py-3 flex flex-col items-center justify-center active:scale-[0.98] transition-all disabled:opacity-50 touch-manipulation"
        >
          <span className="text-[20px] font-black tracking-wide text-[#e5484d]">{isPlacing === 'sell' ? '…' : 'SELL'}</span>
          <span className="text-[12px] font-medium tracking-wide text-[#e5484d]/80">BY MARKET</span>
        </button>
        <button
          onClick={() => void placeOrder('buy')}
          disabled={isPlacing !== null || symbolId === null || !lockVerdict.allowed}
          className="py-3 flex flex-col items-center justify-center active:scale-[0.98] transition-all disabled:opacity-50 touch-manipulation"
        >
          <span className="text-[20px] font-black tracking-wide text-[#5b8def]">{isPlacing === 'buy' ? '…' : 'BUY'}</span>
          <span className="text-[12px] font-medium tracking-wide text-[#5b8def]/80">BY MARKET</span>
        </button>
      </div>
      {anyLockActive && lockVerdict.allowed && (
        <p className="mt-2 text-center text-[10px] font-medium text-zinc-600">
          Trading locks on for this portfolio · {fillsToday ?? '…'} trade(s) opened today
        </p>
      )}
    </div>
  );
};
