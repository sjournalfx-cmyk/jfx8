import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useToast } from '../ui/Toast';
import { haptic } from '../../lib/haptics';
import { useCtraderSpots } from '../../hooks/useCtraderSpots';
import { calculateLivePositionProfit } from '../../lib/ctraderPnl';
import type { CtraderQuoteSymbol } from '../../hooks/useCtraderSymbols';
import type { CtraderPosition } from '../../services/ctraderService';

interface CtraderPositionsCardProps {
  ctidAccountId?: string | null;
  isDemo?: boolean;
  symbols?: CtraderQuoteSymbol[];
  currencySymbol?: string;
  onGoConnect?: () => void;
}

const digitsForSymbol = (symbolId: number, symbolName: string | undefined, symbols?: CtraderQuoteSymbol[]): number => {
  const d = Number(symbols?.find((s) => Number(s.symbolId) === Number(symbolId))?.digits);
  if (Number.isFinite(d) && d >= 0 && d <= 8) return d;
  // Fallback matches fetchCtraderCandles precedent (JPY → 3, metals → 2, else 5).
  const name = (symbolName || '').toUpperCase().replace('/', '');
  if (name.endsWith('JPY')) return 3;
  if (name.includes('XAU') || name.includes('GOLD')) return 2;
  return 5;
};


/**
 * MT5-style open positions: live P&L per row, two-tap close (arm → confirm).
 */
export const CtraderPositionsCard: React.FC<CtraderPositionsCardProps> = ({
  ctidAccountId,
  isDemo = true,
  symbols = [],
  currencySymbol = '$',
  onGoConnect,
}) => {
  const { addToast } = useToast();
  const numericAccountId = useMemo(() => {
    const n = Number(ctidAccountId);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [ctidAccountId]);

  const [positions, setPositions] = useState<CtraderPosition[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<number | null>(null);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const confirmTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (numericAccountId === null) return;
    try {
      const svc = await import('../../services/ctraderService');
      const list = await svc.getPositions(numericAccountId, isDemo);
      setPositions(list || []);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Could not load positions.');
    }
  }, [numericAccountId, isDemo]);

  // Initial load + poll for live P&L.
  useEffect(() => {
    if (numericAccountId === null) {
      setPositions([]);
      return;
    }
    setIsLoading(true);
    void load().finally(() => setIsLoading(false));
    const intervalId = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(intervalId);
  }, [numericAccountId, isDemo, load]);

  // Refresh right after fills/closes.
  useEffect(() => {
    if (numericAccountId === null) return;
    let unsub: (() => void) | null = null;
    let cancelled = false;
    import('../../services/ctraderService').then((svc) => {
      if (cancelled) return;
      unsub = svc.addCtraderListener((payloadType, _payload, wsIsDemo) => {
        if (wsIsDemo !== isDemo) return;
        if (payloadType === svc.PT.EXECUTION_EVENT) void load();
      });
    });
    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [numericAccountId, isDemo, load]);

  useEffect(
    () => () => {
      if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current);
    },
    []
  );

  // Live quotes for the held symbols so rows show real-time prices.
  const positionSymbolIds = useMemo(
    () => [...new Set(positions.map((p) => Number(p.symbolId)).filter((n) => Number.isFinite(n)))],
    [positions]
  );
  const ticks = useCtraderSpots(ctidAccountId, isDemo, positionSymbolIds);

  const requestClose = useCallback(
    (positionId: number) => {
      try {
        haptic.selection();
      } catch {}
      if (confirmingId === positionId) {
        // Second tap executes (handled by confirmClose); ignore here.
        return;
      }
      setConfirmingId(positionId);
      if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current);
      confirmTimer.current = window.setTimeout(() => setConfirmingId(null), 4000);
    },
    [confirmingId]
  );

  const confirmClose = useCallback(
    async (pos: CtraderPosition) => {
      if (numericAccountId === null || closingId !== null) return;
      setClosingId(pos.positionId);
      try {
        try {
          haptic.selection();
        } catch {}
        const svc = await import('../../services/ctraderService');
        await svc.closePosition(numericAccountId, pos.positionId, Number(pos.volume) || 0, isDemo);
        setConfirmingId(null);
        addToast({
          type: 'success',
          title: 'Position closed',
          message: `${pos.tradeSide === 'buy' ? 'Buy' : 'Sell'} ${Number(pos.volume).toFixed(2)} ${pos.symbol} closed`,
          duration: 4000,
        });
        await load();
      } catch (e: any) {
        addToast({ type: 'error', title: 'Close failed', message: e?.message || 'Could not close position.', duration: 5000 });
      } finally {
        setClosingId(null);
      }
    },
    [numericAccountId, isDemo, closingId, load, addToast]
  );

  if (numericAccountId === null) {
    return (
      <div className="px-4 pb-4">
        <div className="p-5 rounded-2xl border bg-[#0a0a0a] border-zinc-800/80 text-center">
          <p className="text-[15px] font-bold text-white">No cTrader account linked</p>
          <p className="text-[12px] text-zinc-500 mt-1">Link this portfolio to manage live positions here.</p>
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

  const fmtMoney = (v: number) => {
    const abs = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${v < 0 ? '-' : ''}${currencySymbol}${abs}`;
  };

  return (
    <div className="px-4 pb-6">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[13px] font-black uppercase tracking-widest text-zinc-500">
          Open Positions{positions.length > 0 ? ` · ${positions.length}` : ''}
        </p>
        {isLoading && positions.length === 0 && <p className="text-[11px] text-zinc-600">Loading…</p>}
      </div>

      {error && positions.length === 0 ? (
        <p className="text-[12px] font-medium text-rose-400">{error}</p>
      ) : positions.length === 0 ? (
        <div className="p-5 rounded-2xl border bg-[#0a0a0a] border-zinc-800/80 text-center">
          <p className="text-[13px] font-bold text-zinc-400">No open positions</p>
          <p className="text-[11px] text-zinc-600 mt-1">New market orders will appear here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {positions.map((pos) => {
            const digits = digitsForSymbol(Number(pos.symbolId), pos.symbol, symbols);
            const tick = ticks[String(pos.symbolId)];
            const isBuy = pos.tradeSide === 'buy';
            const {
              floating: pnl,
              formattedCurrentPrice,
              formattedOpenPrice,
            } = calculateLivePositionProfit(pos, tick?.bid, tick?.ask, digits);
            const isArmed = confirmingId === pos.positionId;
            const isClosing = closingId === pos.positionId;
            return (
              <div key={pos.positionId} className="p-3.5 rounded-2xl border bg-[#0a0a0a] border-zinc-800/80">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[15px] font-black text-white truncate">{pos.symbol}</span>
                      <span
                        className={`text-[10px] font-black px-1.5 py-0.5 rounded ${
                          isBuy ? 'bg-[#5b8def]/15 text-[#5b8def]' : 'bg-[#e5484d]/15 text-[#e5484d]'
                        }`}
                      >
                        {isBuy ? 'BUY' : 'SELL'} {Number(pos.volume).toFixed(2)}
                      </span>
                    </div>
                    <p className="text-[11px] tabular-nums text-zinc-500 mt-1">
                      {formattedOpenPrice}
                      {' → '}
                      {formattedCurrentPrice}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[16px] font-black tabular-nums ${pnl >= 0 ? 'text-[#5b8def]' : 'text-[#e5484d]'}`}>
                      {pnl >= 0 ? '+' : ''}
                      {fmtMoney(pnl)}
                    </span>
                    <button
                      onClick={() => (isArmed ? void confirmClose(pos) : requestClose(pos.positionId))}
                      disabled={isClosing}
                      aria-label={isArmed ? `Confirm close ${pos.symbol} position` : `Close ${pos.symbol} position`}
                      className={`h-9 min-w-[36px] px-2 rounded-lg flex items-center justify-center text-[11px] font-black transition-all touch-manipulation active:scale-95 disabled:opacity-50 ${
                        isArmed ? 'bg-[#e5484d] text-white' : 'bg-white/[0.06] text-zinc-400'
                      }`}
                    >
                      {isClosing ? '…' : isArmed ? 'Close?' : <X size={15} />}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
