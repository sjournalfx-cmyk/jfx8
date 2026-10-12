import React, { useState } from 'react';
import { X, Pencil } from 'lucide-react';
import { haptic } from '../lib/haptics';

import { calculateLivePositionProfit } from '../lib/ctraderPnl';

interface CtraderPositionRowProps {
  position: any;
  symbolName: string;
  /** Symbol digits for scaling raw wire prices. Falls back to a name heuristic. */
  digits?: number;
  /** Raw wire bid from the live spot stream (scaled integer). */
  liveBid?: number;
  /** Raw wire ask from the live spot stream (scaled integer). */
  liveAsk?: number;
  onClose: (position: any) => Promise<void>;
  onSaveSltp: (position: any, stopLoss: number | undefined, takeProfit: number | undefined) => Promise<void>;
}

const digitsForName = (symbolName: string, explicit?: number): number => {
  const d = Number(explicit);
  if (Number.isFinite(d) && d >= 0 && d <= 8) return d;
  const name = (symbolName || '').toUpperCase().replace('/', '');
  if (name.endsWith('JPY')) return 3;
  if (name.includes('XAU') || name.includes('GOLD')) return 2;
  return 5;
};

const scaleDown = (raw: unknown, digits: number): number | undefined => {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n === 0) return undefined;
  return n / Math.pow(10, digits);
};

/**
 * Open-position row mirroring the MT5 style: live ticking P&L per row,
 * openPrice -> currentPrice live ticker, buy/sell badge, and two-way swipe gestures:
 * swipe right reveals Close (red X), swipe left reveals Edit (orange pencil
 * → inline SL/TP editor). Clamp ±76px, snap threshold ±38px.
 */
export const CtraderPositionRow: React.FC<CtraderPositionRowProps> = ({
  position: p,
  symbolName,
  digits: digitsProp,
  liveBid,
  liveAsk,
  onClose,
  onSaveSltp,
}) => {
  const [swipeX, setSwipeX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const touchStartX = React.useRef<number | null>(null);
  const touchStartY = React.useRef<number | null>(null);
  const touchMoved = React.useRef(false);

  const [isEditing, setIsEditing] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const digits = digitsForName(symbolName, digitsProp);
  const [slInput, setSlInput] = useState('');
  const [tpInput, setTpInput] = useState('');

  const isBuy = String(p.tradeSide || '').toLowerCase() === 'buy';

  const {
    currentPrice,
    floating,
    formattedCurrentPrice,
    formattedOpenPrice,
  } = calculateLivePositionProfit(p, liveBid, liveAsk, digits);

  // Flash tick color when price moves (MT5 style)
  const prevPriceRef = React.useRef(currentPrice);
  const [tickColor, setTickColor] = useState<'up' | 'down' | null>(null);

  React.useEffect(() => {
    if (prevPriceRef.current !== currentPrice && Number.isFinite(currentPrice) && currentPrice > 0) {
      const dir = currentPrice > prevPriceRef.current ? 'up' : 'down';
      prevPriceRef.current = currentPrice;
      setTickColor(dir);
      const timer = window.setTimeout(() => setTickColor(null), 600);
      return () => window.clearTimeout(timer);
    }
  }, [currentPrice]);

  const openEditor = () => {
    const sl = scaleDown(p.stopLoss, digits);
    const tp = scaleDown(p.takeProfit, digits);
    setSlInput(sl !== undefined ? String(sl) : '');
    setTpInput(tp !== undefined ? String(tp) : '');
    setIsEditing(true);
    setSwipeX(0);
  };

  const handleClose = async () => {
    setSwipeX(0);
    if (!window.confirm(`Close ${p.tradeSide === 'sell' ? 'Short' : 'Long'} ${Number(p.volume || 0).toFixed(2)} ${symbolName} at market?`)) return;
    setIsBusy(true);
    try {
      await onClose(p);
    } catch (e: any) {
      window.alert(e?.message || 'Could not close position.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleSave = async () => {
    const sl = slInput.trim() === '' ? undefined : Number(slInput);
    const tp = tpInput.trim() === '' ? undefined : Number(tpInput);
    if (sl !== undefined && !Number.isFinite(sl)) {
      window.alert('Stop loss must be a valid price.');
      return;
    }
    if (tp !== undefined && !Number.isFinite(tp)) {
      window.alert('Take profit must be a valid price.');
      return;
    }
    setIsBusy(true);
    try {
      await onSaveSltp(p, sl, tp);
      setIsEditing(false);
    } catch (e: any) {
      window.alert(e?.message || 'Could not update SL/TP.');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="relative overflow-hidden">
      {/* Swipe right → Close (left well) */}
      {(dragging || swipeX !== 0) && swipeX >= 0 && (
        <div className="absolute left-0 top-0 bottom-0 w-[76px] flex items-center justify-start pl-1">
          <button
            type="button"
            aria-label={`Close ${symbolName} position`}
            onClick={(e) => {
              e.stopPropagation();
              void handleClose();
            }}
            className="w-[60px] h-[44px] rounded-xl bg-[#e5484d] text-white flex items-center justify-center shadow-lg active:scale-95 transition-transform"
          >
            <X size={20} />
          </button>
        </div>
      )}
      {/* Swipe left → Edit (right well) */}
      {(dragging || swipeX !== 0) && swipeX <= 0 && (
        <div className="absolute right-0 top-0 bottom-0 w-[76px] flex items-center justify-end pr-1">
          <button
            type="button"
            aria-label={`Edit ${symbolName} stop loss and take profit`}
            onClick={(e) => {
              e.stopPropagation();
              try {
                haptic.selection();
              } catch {}
              openEditor();
            }}
            className="w-[60px] h-[44px] rounded-xl bg-[#FF4F01] text-white flex items-center justify-center shadow-lg active:scale-95 transition-transform"
          >
            <Pencil size={18} />
          </button>
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
          if (isEditing) setIsEditing(false);
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
          setSwipeX(Math.max(-76, Math.min(76, dx)));
        }}
        onTouchEnd={() => {
          touchStartX.current = null;
          touchStartY.current = null;
          setDragging(false);
          setSwipeX((v) => (v < -38 ? -76 : v > 38 ? 76 : 0));
        }}
        className={`relative z-10 bg-[#000000] select-none ${
          dragging ? '' : 'transition-transform duration-200'
        } ${isBusy ? 'opacity-60 pointer-events-none' : ''}`}
      >
        <div className="flex items-center justify-between py-2.5 border-b border-white/5 last:border-0">
          <div className="min-w-0 pr-3 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h3 className="text-[13px] font-bold uppercase tracking-tight leading-tight text-white truncate">{symbolName}</h3>
              <span className={`text-[10px] font-black uppercase px-1.5 py-0.5 rounded leading-none ${
                isBuy ? 'bg-[#5b8def]/20 text-[#5b8def]' : 'bg-[#e5484d]/20 text-[#e5484d]'
              }`}>
                {isBuy ? 'Buy' : 'Sell'} {Number(p.volume || 0).toFixed(2)}
              </span>
            </div>
            <div className="flex items-center gap-1.5 mt-1 text-[11px] tabular-nums font-medium leading-tight">
              <span className="text-zinc-500">{formattedOpenPrice}</span>
              <span className="text-zinc-600">→</span>
              <span className={
                tickColor === 'up'
                  ? 'text-[#5b8def] font-bold transition-colors duration-200'
                  : tickColor === 'down'
                  ? 'text-[#e5484d] font-bold transition-colors duration-200'
                  : 'text-zinc-300'
              }>
                {formattedCurrentPrice}
              </span>
              {(scaleDown(p.stopLoss, digits) !== undefined || scaleDown(p.takeProfit, digits) !== undefined) && (
                <span className="text-[10px] text-zinc-500 ml-1">
                  {scaleDown(p.stopLoss, digits) !== undefined && `sl: ${scaleDown(p.stopLoss, digits)} `}
                  {scaleDown(p.takeProfit, digits) !== undefined && `tp: ${scaleDown(p.takeProfit, digits)}`}
                </span>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            <span className={`text-[14px] font-bold tabular-nums transition-colors duration-300 ${
              floating >= 0 ? 'text-[#30a46c]' : 'text-[#e5484d]'
            }`}>
              {floating > 0 ? '+' : ''}
              {floating.toFixed(2)}
            </span>
          </div>
        </div>

        {isEditing && (
          <div className="py-2 border-b border-white/5" onClick={(e) => e.stopPropagation()}>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Stop loss</label>
                <input
                  value={slInput}
                  onChange={(e) => setSlInput(e.target.value.replace(/[^0-9.]/g, ''))}
                  inputMode="decimal"
                  placeholder="Empty = keep"
                  aria-label="Stop loss price"
                  className="w-full h-10 rounded-lg border bg-[#000000] border-[#27272a] px-2.5 text-[12px] tabular-nums text-white placeholder:text-zinc-600 outline-none focus:border-[#FF4F01]"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Take profit</label>
                <input
                  value={tpInput}
                  onChange={(e) => setTpInput(e.target.value.replace(/[^0-9.]/g, ''))}
                  inputMode="decimal"
                  placeholder="Empty = keep"
                  aria-label="Take profit price"
                  className="w-full h-10 rounded-lg border bg-[#000000] border-[#27272a] px-2.5 text-[12px] tabular-nums text-white placeholder:text-zinc-600 outline-none focus:border-[#FF4F01]"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="flex-1 h-10 rounded-lg text-[12px] font-bold text-zinc-400 active:scale-95 transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={isBusy}
                className="flex-1 h-10 rounded-lg bg-[#FF4F01] text-white text-[12px] font-bold active:scale-95 transition-all disabled:opacity-50"
              >
                {isBusy ? 'Saving…' : 'Save SL/TP'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
