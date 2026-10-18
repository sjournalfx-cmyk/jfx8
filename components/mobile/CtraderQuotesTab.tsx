import React, { useMemo, useState } from 'react';
import { Check, ChevronLeft, Lock, Plus, Trash2, Zap } from 'lucide-react';
import { haptic } from '../../lib/haptics';
import { groupCtraderSymbol, SYMBOL_GROUP_ORDER, type CtraderSymbolGroup } from '../../lib/ctraderSymbolGroups';
import type { CtraderQuoteSymbol } from '../../hooks/useCtraderSymbols';
import { useCtraderSpots } from '../../hooks/useCtraderSpots';
import { useToast } from '../ui/Toast';
import { isRuleActive, readPortfolioLocks } from '../../lib/tradingLocks';

interface CtraderQuotesTabProps {
  symbols: CtraderQuoteSymbol[];
  isLoading: boolean;
  error: string | null;
  selectedSymbolId: number | null;
  onSelect: (symbolId: number) => void;
  onRetry?: () => void;
  /** Navigate to the existing cTrader connect flow when the session is dead. */
  onReconnect?: () => void;
  ctidAccountId?: string | null;
  isDemo?: boolean;
  portfolioId?: string | null;
  /** Fired when the add-symbols browser opens/closes (hides the tab switcher). */
  onAddingChange?: (adding: boolean) => void;
}

const digitsFor = (symbol?: CtraderQuoteSymbol | null): number => {
  const d = Number(symbol?.digits);
  if (Number.isFinite(d) && d >= 0 && d <= 8) return d;
  // Fallback matches fetchCtraderCandles precedent (JPY → 3, else 5).
  const name = (symbol?.symbolName || '').toUpperCase().replace('/', '');
  if (name.endsWith('JPY')) return 3;
  if (name.includes('XAU') || name.includes('GOLD')) return 2;
  return 5;
};

/**
 * MT5-style price: normal prefix + LARGE pip figures + superscript fractional
 * (e.g. 1.12|21|²). Wire integer normalized by digits first.
 */
const QuotePrice: React.FC<{ value?: number; digits: number; down: boolean }> = ({ value, digits, down }) => {
  if (value === undefined || !Number.isFinite(value)) {
    return <span className="text-[17px] font-black tabular-nums text-zinc-700">—</span>;
  }
  const human = value / Math.pow(10, digits);
  if (!Number.isFinite(human)) {
    return <span className="text-[17px] font-black tabular-nums text-zinc-700">—</span>;
  }
  const fixed = human.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const color = down ? 'text-[#e5484d]' : 'text-[#5b8def]';
  if (digits <= 2) {
    return <span className={`text-[17px] font-black tabular-nums ${color}`}>{fixed}</span>;
  }
  const prefix = fixed.slice(0, -3);
  const big = fixed.slice(-3, -1);
  const sup = fixed.slice(-1);
  return (
    <span className={`tabular-nums ${color}`}>
      <span className="text-[15px] font-bold">{prefix}</span>
      <span className="text-[22px] font-black leading-none">{big}</span>
      <sup className="text-[12px] font-black">{sup}</sup>
    </span>
  );
};

/** Compact session L/H line under the prices (MT5 layout). */
const RangeLine: React.FC<{ lo?: number; hi?: number; digits: number }> = ({ lo, hi, digits }) => {
  if (lo === undefined || hi === undefined || !Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  const fmt = (v: number) =>
    (v / Math.pow(10, digits)).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return (
    <span className="block text-right text-[10px] tabular-nums text-zinc-500 leading-tight mt-0.5">
      L: {fmt(lo)}&nbsp;&nbsp;H: {fmt(hi)}
    </span>
  );
};

/**
 * Watchlist row: swipe right / tap opens the quote drawer (New Order /
 * Chart), swipe left removes the pair. Vertical scroll always wins over
 * horizontal swipe.
 */
const WatchRow: React.FC<{
  symbol: CtraderQuoteSymbol;
  tick?: { bid?: number; ask?: number; dir?: 'up' | 'down' | null; lo?: number; hi?: number };
  digits: number;
  down: boolean;
  locked: boolean;
  isSelected: boolean;
  onOpen: () => void;
  onRemove: () => void;
}> = ({ symbol: s, tick, digits, down, locked, isSelected, onOpen, onRemove }) => {
  const [swipeX, setSwipeX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const touchStartX = React.useRef<number | null>(null);
  const touchStartY = React.useRef<number | null>(null);
  const touchMoved = React.useRef(false);

  const fire = (action: 'open' | 'remove') => {
    try {
      haptic.selection();
    } catch {}
    setSwipeX(0);
    if (action === 'open') onOpen();
    else onRemove();
  };

  return (
    <div className="relative overflow-hidden rounded-xl">
      {/* Swipe right → trade page (left well) */}
      {(dragging || swipeX !== 0) && swipeX >= 0 && (
        <div className="absolute left-0 top-0 bottom-0 w-[76px] flex items-center justify-start pl-1">
          <div className="w-[60px] h-[44px] rounded-xl bg-[#FF4F01] text-white flex items-center justify-center shadow-lg">
            <Zap size={18} />
          </div>
        </div>
      )}
      {/* Swipe left → remove (right well) */}
      {(dragging || swipeX !== 0) && swipeX <= 0 && (
        <div className="absolute right-0 top-0 bottom-0 w-[76px] flex items-center justify-end pr-1">
          <div className="w-[60px] h-[44px] rounded-xl bg-[#e5484d] text-white flex items-center justify-center shadow-lg">
            <Trash2 size={18} />
          </div>
        </div>
      )}
      <div
        style={{ transform: `translateX(${swipeX}px)` }}
        onClick={() => {
          if (touchMoved.current) {
            touchMoved.current = false;
            return;
          }
          if (swipeX !== 0) {
            setSwipeX(0);
            return;
          }
          onOpen();
        }}
        onTouchStart={(e) => {
          touchStartX.current = e.touches[0].clientX;
          touchStartY.current = e.touches[0].clientY;
          touchMoved.current = false;
          setDragging(true);
        }}
        onTouchMove={(e) => {
          if (touchStartX.current === null || touchStartY.current === null) return;
          const dx = e.touches[0].clientX - touchStartX.current;
          const dy = e.touches[0].clientY - touchStartY.current;
          if (Math.abs(dx) > 10 || Math.abs(dy) > 10) touchMoved.current = true;
          if (Math.abs(dy) > Math.abs(dx)) {
            setSwipeX(0);
            return;
          }
          setSwipeX(Math.max(-90, Math.min(90, dx)));
        }}
        onTouchEnd={() => {
          touchStartX.current = null;
          touchStartY.current = null;
          setDragging(false);
          setSwipeX((v) => {
            if (v <= -60) {
              fire('remove');
              return 0;
            }
            if (v >= 60) {
              fire('open');
              return 0;
            }
            return 0;
          });
        }}
        aria-label={locked ? `${s.symbolName} locked by trading lock` : `Trade ${s.symbolName}`}
        className={`relative z-10 bg-[#000000] w-full flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl select-none touch-manipulation active:scale-[0.99] ${
          dragging ? '' : 'transition-transform duration-200'
        } ${isSelected && !locked ? 'bg-[#FF4F01]/15' : ''} ${locked ? 'opacity-50' : ''}`}
      >
        <span
          className={`flex items-center gap-1.5 text-[17px] font-bold tracking-tight truncate ${
            locked ? 'text-zinc-600' : isSelected ? 'text-[#FF4F01]' : 'text-zinc-200'
          }`}
        >
          {locked && <Lock size={13} className="shrink-0 text-zinc-600" />}
          {s.symbolName}
        </span>
        <span className="shrink-0">
          <span className="flex items-start gap-3">
            <QuotePrice value={tick?.bid} digits={digits} down={down} />
            <QuotePrice value={tick?.ask} digits={digits} down={down} />
          </span>
          <RangeLine lo={tick?.lo} hi={tick?.hi} digits={digits} />
        </span>
      </div>
    </div>
  );
};

/**
 * MT5-style Quotes picker: category pills (Forex/Crypto/Indices/Commodities)
 * + scrollable pair list. Tapping a pair selects it for the Trade tab.
 */
export const CtraderQuotesTab: React.FC<CtraderQuotesTabProps> = ({
  symbols,
  isLoading,
  error,
  selectedSymbolId,
  onSelect,
  onRetry,
  onReconnect,
  ctidAccountId,
  isDemo = true,
  portfolioId,
  onAddingChange,
}) => {
  const { addToast } = useToast();

  // Auth/session failures can't be fixed by retrying the same request.
  const showReconnect = !!onReconnect && /access[_ ]denied|not authenticated|sign in again|signed out|session[\s\S]{0,40}expired|disconnected|reconnect ctrader/i.test(error || '');

  // Pair whitelist for this portfolio (greyed locked rows, never hidden).
  const [whitelist, setWhitelist] = useState(() => readPortfolioLocks(portfolioId).pairWhitelist);
  React.useEffect(() => {
    setWhitelist(readPortfolioLocks(portfolioId).pairWhitelist);
  }, [portfolioId]);
  const whitelistActive = isRuleActive(whitelist);
  const isLockedSymbol = (id: number) =>
    whitelistActive && !whitelist.symbolIds.map(Number).includes(Number(id));

  const grouped = useMemo(() => {
    const map = new Map<CtraderSymbolGroup, CtraderQuoteSymbol[]>();
    for (const s of symbols) {
      const g = groupCtraderSymbol(s.symbolName);
      const arr = map.get(g) ?? [];
      arr.push(s);
      map.set(g, arr);
    }
    return map;
  }, [symbols]);

  // Personal watchlist: starts empty, persisted per cTrader account.
  // The Quotes page shows ONLY these — pairs are added via + Add symbols.
  const numericWatchId = (() => {
    const n = Number(ctidAccountId);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  const watchKey = `jfx_quotes_watchlist_${numericWatchId ?? 'none'}`;
  const [watchlist, setWatchlist] = useState<number[]>(() => {
    try {
      const raw = localStorage.getItem(watchKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.map(Number).filter((n) => Number.isFinite(n)) : [];
    } catch {
      return [];
    }
  });
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(watchKey);
      const parsed = raw ? JSON.parse(raw) : [];
      setWatchlist(Array.isArray(parsed) ? parsed.map(Number).filter((n) => Number.isFinite(n)) : []);
    } catch {
      setWatchlist([]);
    }
    setAdding(false);
    onAddingChange?.(false);
  }, [watchKey]);
  const persistWatchlist = (next: number[]) => {
    setWatchlist(next);
    try {
      localStorage.setItem(watchKey, JSON.stringify(next));
    } catch {
      /* storage blocked */
    }
  };
  const toggleWatch = (id: number) => {
    try {
      haptic.selection();
    } catch {}
    const n = Number(id);
    setWatchlist((prev) => {
      const next = prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n];
      try {
        localStorage.setItem(watchKey, JSON.stringify(next));
      } catch {
        /* storage blocked */
      }
      return next;
    });
  };

  // Browser mode (add symbols): full searchable list grouped by category.
  const [adding, setAdding] = useState(false);
  const [browseGroup, setBrowseGroup] = useState<CtraderSymbolGroup>('Forex');
  const [browseQuery, setBrowseQuery] = useState('');
  const browseList = useMemo(() => {
    const base = grouped.get(browseGroup) ?? [];
    const q = browseQuery.trim().toUpperCase();
    const list = q ? base.filter((s) => s.symbolName.toUpperCase().includes(q)) : base;
    return list;
  }, [grouped, browseGroup, browseQuery]);

  // Watchlist rows in the user's order; live prices for those only.
  const watchRows = useMemo(
    () =>
      watchlist
        .map((id) => symbols.find((s) => Number(s.symbolId) === Number(id)))
        .filter((s): s is CtraderQuoteSymbol => !!s),
    [watchlist, symbols]
  );
  const visibleIds = useMemo(() => (adding ? [] : watchRows.map((s) => Number(s.symbolId))), [adding, watchRows]);
  const ticks = useCtraderSpots(ctidAccountId, isDemo, visibleIds);

  const openBrowser = () => {
    try {
      haptic.selection();
    } catch {}
    setBrowseQuery('');
    setAdding(true);
    onAddingChange?.(true);
  };

  const closeBrowser = () => {
    try {
      haptic.selection();
    } catch {}
    setAdding(false);
    onAddingChange?.(false);
  };

  const pickSymbol = (id: number, name: string) => {
    try {
      haptic.selection();
    } catch {}
    if (isLockedSymbol(id)) {
      addToast({ type: 'error', title: 'Pair locked', message: `${name} isn't on your allowed-pairs list. Adjust in Rules & Checklists.`, duration: 4000 });
      return;
    }
    onSelect(id);
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar bg-[#000000]">
      {adding ? (
        <>
          {/* Add-symbols browser header (sticky) */}
          <div className="sticky top-0 z-10 px-2 py-1 bg-[#000000]">
            <div className="flex items-center gap-2 mb-1">
              <button
                type="button"
                onClick={closeBrowser}
                aria-label="Back to my pairs"
                className="h-9 px-2 rounded-lg flex items-center gap-1 text-[13px] font-bold text-zinc-300 active:scale-95 shrink-0"
              >
                <ChevronLeft size={18} /> Back
              </button>
              <div className="relative flex-1">
                <input
                  value={browseQuery}
                  onChange={(e) => setBrowseQuery(e.target.value)}
                  placeholder="Search pairs…"
                  aria-label="Search all pairs"
                  className="w-full h-9 rounded-lg border bg-[#000000] border-[#27272a] px-3 text-[12px] text-white placeholder:text-zinc-600 outline-none focus:border-[#FF4F01]"
                />
              </div>
            </div>
            <div className="flex items-center rounded border border-[#262626] bg-[#131313] overflow-x-auto no-scrollbar" role="tablist" aria-label="Symbol groups">
              {SYMBOL_GROUP_ORDER.map((g) => {
                const isActive = g === browseGroup;
                return (
                  <button
                    key={g}
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => {
                      try {
                        haptic.selection();
                      } catch {}
                      setBrowseGroup(g);
                    }}
                    className={`flex-1 whitespace-nowrap h-6 px-2 rounded text-[11px] font-bold transition-all touch-manipulation active:scale-95 ${
                      isActive
                        ? 'bg-[#333333] text-white border border-[#3d3d3d] shadow'
                        : 'text-zinc-500 border border-transparent'
                    }`}
                  >
                    {g}
                  </button>
                );
              })}
            </div>
          </div>

          {/* All pairs with add toggles */}
          <div className="px-2 py-2 pb-28">
            {isLoading && symbols.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-[13px] font-medium text-zinc-500">Loading symbols…</p>
              </div>
            ) : error && symbols.length === 0 ? (
              <div className="py-10 text-center px-6">
                <p className="text-[13px] font-medium text-rose-400">{error}</p>
                {onRetry && (
                  <button
                    onClick={onRetry}
                    className="mt-3 h-11 px-5 rounded-xl bg-[#FF4F01] text-white text-xs font-bold active:scale-95 transition-all"
                  >
                    Retry
                  </button>
                )}
                {showReconnect && (
                  <button
                    onClick={onReconnect}
                    className="mt-3 ml-2 h-11 px-5 rounded-xl border border-[#FF4F01] text-[#FF4F01] text-xs font-bold active:scale-95 transition-all"
                  >
                    Reconnect cTrader
                  </button>
                )}
              </div>
            ) : browseList.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-[13px] font-medium text-zinc-500">No {browseGroup} symbols on this account.</p>
              </div>
            ) : (
              browseList.map((s) => {
                const added = watchlist.map(Number).includes(Number(s.symbolId));
                return (
                  <button
                    key={s.symbolId}
                    onClick={() => toggleWatch(s.symbolId)}
                    aria-label={added ? `Remove ${s.symbolName} from my pairs` : `Add ${s.symbolName} to my pairs`}
                    className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl transition-all touch-manipulation active:scale-[0.99] ${
                      added ? 'bg-[#FF4F01]/15' : ''
                    }`}
                  >
                    <span className={`text-[17px] font-bold tracking-tight truncate ${added ? 'text-[#FF4F01]' : 'text-zinc-200'}`}>
                      {s.symbolName}
                    </span>
                    <span
                      className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                        added ? 'bg-[#FF4F01] text-white' : 'bg-white/[0.06] text-zinc-300'
                      }`}
                    >
                      {added ? <Check size={16} /> : <Plus size={16} />}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </>
      ) : (
        <>
          {/* Watchlist header (sticky) */}
          <div className="sticky top-0 z-10 px-2 py-1 bg-[#000000]">
            <button
              type="button"
              onClick={openBrowser}
              className="w-full h-11 rounded-xl bg-[#2B7FFF]/10 text-white text-[15px] font-bold flex items-center justify-center gap-2 active:scale-[0.99] transition-all touch-manipulation"
            >
              <Plus size={18} /> Add symbols
            </button>
          </div>

          {/* My pairs */}
          <div className="px-2 py-2 pb-28">
            {isLoading && symbols.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-[13px] font-medium text-zinc-500">Loading symbols…</p>
              </div>
            ) : error && symbols.length === 0 ? (
              <div className="py-10 text-center px-6">
                <p className="text-[13px] font-medium text-rose-400">{error}</p>
                {onRetry && (
                  <button
                    onClick={onRetry}
                    className="mt-3 h-11 px-5 rounded-xl bg-[#FF4F01] text-white text-xs font-bold active:scale-95 transition-all"
                  >
                    Retry
                  </button>
                )}
                {showReconnect && (
                  <button
                    onClick={onReconnect}
                    className="mt-3 ml-2 h-11 px-5 rounded-xl border border-[#FF4F01] text-[#FF4F01] text-xs font-bold active:scale-95 transition-all"
                  >
                    Reconnect cTrader
                  </button>
                )}
              </div>
            ) : watchRows.length === 0 ? (
              <div className="py-14 text-center px-8">
                <p className="text-[15px] font-bold text-zinc-300">No pairs yet</p>
                <p className="text-[12px] text-zinc-500 mt-1">Tap + Add symbols above to add the pairs you trade.</p>
              </div>
            ) : (
              watchRows.map((s) => {
                const isSelected = Number(s.symbolId) === Number(selectedSymbolId);
                const tick = ticks[String(s.symbolId)];
                const digits = digitsFor(s);
                const down = tick?.dir === 'down';
                const locked = isLockedSymbol(s.symbolId);
                return (
                  <WatchRow
                    key={s.symbolId}
                    symbol={s}
                    tick={tick}
                    digits={digits}
                    down={down}
                    locked={locked}
                    isSelected={isSelected}
                    onOpen={() => pickSymbol(s.symbolId, s.symbolName)}
                    onRemove={() => toggleWatch(s.symbolId)}
                  />
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
};
