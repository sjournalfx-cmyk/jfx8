import React, { useState } from 'react';
import { X, Pencil, ArrowUpRight } from 'lucide-react';
import { haptic } from '../lib/haptics';
import { useToast } from './ui/Toast';
import ConfirmationModal from './ConfirmationModal';

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
  /** Navigate to the existing cTrader connect flow when the session is dead. */
  onReconnect?: () => void;
  /** Desktop: show explicit edit/close buttons instead of swipe-only actions. */
  desktopActions?: boolean;
  /** Desktop: open the full trade detail for this position. */
  onOpenDetail?: () => void;
}

// Auth/session failures can't be fixed by retrying the same request — the only
// recovery is re-authorising the cTrader connection. Kept tight so a transient
// network error ("Failed to fetch") still offers Retry.
const isAuthError = (message: string): boolean =>
  /access[_ ]denied|not authenticated|sign in again|signed out|session[\s\S]{0,40}expired|session could not be established|invalid[_ ]?token|expired[_ ]?token/i.test(message);

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
  onReconnect,
  desktopActions = false,
  onOpenDetail,
}) => {
  const [swipeX, setSwipeX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const touchStartX = React.useRef<number | null>(null);
  const touchStartY = React.useRef<number | null>(null);
  const touchMoved = React.useRef(false);

  const [isEditing, setIsEditing] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const { addToast } = useToast();
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

  const handleClose = () => {
    setSwipeX(0);
    setConfirmingClose(true);
  };

  const confirmClose = async () => {
    setConfirmingClose(false);
    setIsBusy(true);
    try {
      await onClose(p);
    } catch (e: any) {
      const message = e?.message || 'Could not close position.';
      const canReconnect = isAuthError(message) && !!onReconnect;
      addToast({
        type: 'error',
        title: 'Position not closed',
        message: canReconnect ? `${message} Reconnect cTrader to continue.` : `${message} Check your connection, then retry.`,
        duration: 8000,
        action: canReconnect
          ? { label: 'Reconnect cTrader', onClick: () => { onReconnect?.(); } }
          : { label: 'Retry', onClick: () => { void confirmClose(); } },
      });
    } finally {
      setIsBusy(false);
    }
  };

  const handleSave = async () => {
    const sl = slInput.trim() === '' ? undefined : Number(slInput);
    const tp = tpInput.trim() === '' ? undefined : Number(tpInput);
    if (sl !== undefined && !Number.isFinite(sl)) {
      addToast({ type: 'error', title: 'Invalid stop loss', message: 'Stop loss must be a valid price.', duration: 5000 });
      return;
    }
    if (tp !== undefined && !Number.isFinite(tp)) {
      addToast({ type: 'error', title: 'Invalid take profit', message: 'Take profit must be a valid price.', duration: 5000 });
      return;
    }
    setIsBusy(true);
    try {
      await onSaveSltp(p, sl, tp);
      setIsEditing(false);
    } catch (e: any) {
      const message = e?.message || 'Could not update SL/TP.';
      const canReconnect = isAuthError(message) && !!onReconnect;
      addToast({
        type: 'error',
        title: 'SL/TP not saved',
        message: canReconnect ? `${message} Reconnect cTrader to continue.` : `${message} Check your connection, then retry.`,
        duration: 8000,
        action: canReconnect
          ? { label: 'Reconnect cTrader', onClick: () => { onReconnect?.(); } }
          : { label: 'Retry', onClick: () => { void handleSave(); } },
      });
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
          <div className="flex items-center gap-1 shrink-0">
            {(desktopActions || onOpenDetail) && (
              <div className="flex items-center gap-1 mr-1">
                {onOpenDetail && (
                  <button
                    type="button"
                    aria-label={`Open ${symbolName} trade detail`}
                    title="Open trade detail"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenDetail();
                    }}
                    className="w-8 h-8 rounded-lg border border-white/10 text-zinc-400 hover:text-white hover:bg-white/5 flex items-center justify-center transition-colors"
                  >
                    <ArrowUpRight size={14} />
                  </button>
                )}
                {desktopActions && (
                  <>
                    <button
                      type="button"
                      aria-label={`Edit ${symbolName} stop loss and take profit`}
                      title="Edit SL/TP"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditor();
                      }}
                      className="w-8 h-8 rounded-lg border border-white/10 text-zinc-400 hover:text-[#FF4F01] hover:bg-white/5 flex items-center justify-center transition-colors"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Close ${symbolName} position`}
                      title="Close position"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleClose();
                      }}
                      className="w-8 h-8 rounded-lg border border-white/10 text-zinc-400 hover:text-[#e5484d] hover:bg-white/5 flex items-center justify-center transition-colors"
                    >
                      <X size={15} />
                    </button>
                  </>
                )}
              </div>
            )}
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
      <ConfirmationModal
        isOpen={confirmingClose}
        title="Close position?"
        description={`Close ${p.tradeSide === 'sell' ? 'Short' : 'Long'} ${Number(p.volume || 0).toFixed(2)} ${symbolName} at market?`}
        confirmText="Close at market"
        variant="danger"
        onConfirm={confirmClose}
        onCancel={() => setConfirmingClose(false)}
        isDarkMode={true}
      />
    </div>
  );
};
