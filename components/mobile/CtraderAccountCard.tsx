import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { haptic } from '../../lib/haptics';
import { CtraderPositionRow } from '../CtraderPositionRow';
import { useCtraderSpots } from '../../hooks/useCtraderSpots';
import { calculateLivePositionProfit } from '../../lib/ctraderPnl';
import type { CtraderQuoteSymbol } from '../../hooks/useCtraderSymbols';
import type { CtraderDeal, CtraderPosition } from '../../services/ctraderService';

interface CtraderAccountCardProps {
  ctidAccountId?: string | null;
  isDemo?: boolean;
  symbols?: CtraderQuoteSymbol[];
  onGoConnect?: () => void;
}

const THIRTY_DAYS_MS = 30 * 24 * 3600 * 1000;

const symbolNameFor = (p: { symbol?: unknown; symbolId?: unknown }, symbols: CtraderQuoteSymbol[]): string => {
  if (typeof p.symbol === 'string' && p.symbol && Number.isNaN(Number(p.symbol))) return p.symbol;
  const targetId = p.symbolId !== undefined ? p.symbolId : p.symbol;
  if (targetId !== undefined && targetId !== null) {
    const found = symbols.find((s) => String(s.symbolId) === String(targetId));
    if (found?.symbolName) return found.symbolName;
  }
  return String(p.symbol || 'EURUSD');
};

const digitsFor = (symbolId: number, symbols: CtraderQuoteSymbol[]): number | undefined => {
  const d = Number(symbols.find((s) => Number(s.symbolId) === Number(symbolId))?.digits);
  return Number.isFinite(d) && d >= 0 && d <= 8 ? d : undefined;
};

/**
 * MT5-style Trade tab: account summary (broker, leverage, balance row) plus
 * Positions / Closed Positions tabs. Market execution lives only in the
 * quote-tap detail page — closes and SL/TP edits stay available here.
 */
export const CtraderAccountCard: React.FC<CtraderAccountCardProps> = ({
  ctidAccountId,
  isDemo = true,
  symbols = [],
  onGoConnect,
}) => {
  const numericAccountId = useMemo(() => {
    const n = Number(ctidAccountId);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [ctidAccountId]);

  const [account, setAccount] = useState<any | null>(null);
  const [trader, setTrader] = useState<any | null>(null);
  const [positions, setPositions] = useState<CtraderPosition[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [deals, setDeals] = useState<CtraderDeal[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'positions' | 'history'>('positions');

  const loadAll = useCallback(async () => {
    if (numericAccountId === null) return;
    try {
      const svc = await import('../../services/ctraderService');
      const accs = await svc.getAccounts().catch(() => [] as any[]);
      const match = (accs || []).find((a: any) => Number(a.ctidTraderAccountId) === numericAccountId) ?? null;
      if (match) setAccount(match);
      const [t, pos, ord, dl] = await Promise.all([
        svc.getTrader(numericAccountId, isDemo).catch(() => null),
        svc.getPositions(numericAccountId, isDemo).catch(() => [] as CtraderPosition[]),
        svc.getPendingOrders(numericAccountId, isDemo).catch(() => [] as any[]),
        svc.getClosedDeals(numericAccountId, Date.now() - THIRTY_DAYS_MS, undefined, isDemo).catch(() => [] as CtraderDeal[]),
      ]);
      if (t) setTrader(t);
      setPositions(pos || []);
      setOrders(ord || []);
      setDeals((dl || []).sort((a, b) => Date.parse(b.closeTimestamp || '') - Date.parse(a.closeTimestamp || '')));
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Could not load account.');
    }
  }, [numericAccountId, isDemo]);

  const refreshPositions = useCallback(async () => {
    if (numericAccountId === null) return;
    try {
      const svc = await import('../../services/ctraderService');
      const [t, pos, ord] = await Promise.all([
        svc.getTrader(numericAccountId, isDemo).catch(() => null),
        svc.getPositions(numericAccountId, isDemo).catch(() => null),
        svc.getPendingOrders(numericAccountId, isDemo).catch(() => null),
      ]);
      if (t) setTrader(t);
      if (pos) setPositions(pos);
      if (ord) setOrders(ord);
    } catch {
      /* best-effort live refresh */
    }
  }, [numericAccountId, isDemo]);

  useEffect(() => {
    if (numericAccountId === null) {
      setAccount(null);
      setTrader(null);
      setPositions([]);
      setOrders([]);
      setDeals([]);
      return;
    }
    setIsLoading(true);
    void loadAll().finally(() => setIsLoading(false));
    const intervalId = window.setInterval(() => void refreshPositions(), 15000);
    return () => window.clearInterval(intervalId);
  }, [numericAccountId, isDemo, loadAll, refreshPositions]);

  // Instant refresh on fills/closes + throttled refresh on ticks of held symbols.
  const heldKey = useMemo(
    () =>
      [...new Set(positions.map((p) => Number(p.symbolId)).filter((n) => Number.isFinite(n)))]
        .sort((a, b) => a - b)
        .join(','),
    [positions]
  );
  // Live spot ticks for all held symbols — used for real-time P/L in rows.
  const heldIds = useMemo(() => (heldKey === '' ? [] : heldKey.split(',').map(Number)), [heldKey]);
  const spotTicks = useCtraderSpots(ctidAccountId, isDemo, heldIds);
  useEffect(() => {
    if (numericAccountId === null) return;
    let unsub: (() => void) | null = null;
    let cancelled = false;
    import('../../services/ctraderService').then((svc) => {
      if (cancelled) return;
      unsub = svc.addCtraderListener((payloadType, _payload, wsIsDemo) => {
        if (wsIsDemo !== isDemo) return;
        if (payloadType === svc.PT.EXECUTION_EVENT) {
          void refreshPositions();
        }
      });
    });
    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [numericAccountId, isDemo, refreshPositions]);

  const handleClosePosition = useCallback(
    async (pos: any) => {
      if (numericAccountId === null) throw new Error('No cTrader account selected.');
      const svc = await import('../../services/ctraderService');
      await svc.closePosition(numericAccountId, Number(pos.positionId), Number(pos.volume) || 0, isDemo);
      await refreshPositions();
    },
    [numericAccountId, isDemo, refreshPositions]
  );

  const handleSaveSltp = useCallback(
    async (pos: any, stopLoss?: number, takeProfit?: number) => {
      if (numericAccountId === null) throw new Error('No cTrader account selected.');
      const svc = await import('../../services/ctraderService');
      await svc.amendPositionSltp(numericAccountId, Number(pos.positionId), { stopLoss, takeProfit, isDemo });
      await refreshPositions();
    },
    [numericAccountId, isDemo, refreshPositions]
  );

  if (numericAccountId === null) {
    return (
      <div className="px-4 pt-4 pb-28">
        <div className="p-5 rounded-2xl border bg-[#0a0a0a] border-zinc-800/80 text-center">
          <p className="text-[15px] font-bold text-white">No cTrader account linked</p>
          <p className="text-[12px] text-zinc-500 mt-1">Link this portfolio to see your account here.</p>
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

  const server = (account as any)?.server || trader?.brokerName || 'cTrader';
  const leverage = trader?.leverageInCents ? trader.leverageInCents / 100 : 100;
  const depositAsset = trader?.depositAsset || (account as any)?.currency || 'USD';
  const balance = Number(trader?.balance ?? (account as any)?.balance ?? 0);
  // Compute live floating P/L from spot ticks to derive real-time equity.
  const liveFloatingTotal = useMemo(() => {
    let total = 0;
    for (const pos of positions) {
      const symDigits = digitsFor(Number(pos.symbolId), symbols) ?? 5;
      const tick = spotTicks[String(pos.symbolId)];
      const res = calculateLivePositionProfit(pos, tick?.bid, tick?.ask, symDigits);
      total += res.floating;
    }
    return total;
  }, [positions, spotTicks, symbols]);
  const equity = positions.length > 0 ? balance + liveFloatingTotal : Number(trader?.equity ?? (account as any)?.equity ?? 0);
  const margin = Number(trader?.margin ?? 0);
  const level = margin > 0 && equity > 0 ? `${Math.round((equity / margin) * 100)}%` : '—';
  const openCount = positions.length + orders.length;

  return (
    <div className="px-2.5 pt-2 pb-28">
      <div className="rounded-lg border border-white/5 bg-white/[0.01] overflow-hidden">
        {/* Broker row */}
        <div className="px-3 py-2.5 border-b border-white/5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] text-zinc-500 leading-tight">Broker Server</p>
              <p className="text-xs font-semibold text-white truncate leading-tight mt-px">{server}</p>
              <p className="text-[10px] text-zinc-500 leading-tight mt-1">Deposit Currency</p>
              <p className="text-xs font-semibold text-white truncate leading-tight mt-px">{depositAsset}</p>
            </div>
            <div className="text-right shrink-0">
              <span className={`text-[9px] font-bold uppercase tracking-wide ${isDemo ? 'text-amber-300' : 'text-emerald-300'}`}>
                {isDemo ? 'Demo' : 'Live'}
              </span>
              <p className="text-[10px] text-zinc-500 leading-tight mt-1">Leverage</p>
              <p className="text-xs font-semibold text-white leading-tight mt-px">1:{leverage}</p>
              <p className="text-[10px] text-zinc-500 leading-tight mt-1">Hedging Enabled</p>
              <p className="text-xs font-semibold text-white leading-tight mt-px">{trader?.isHedgingEnabled ? 'Yes' : 'No'}</p>
            </div>
          </div>
        </div>

        {/* Balance row */}
        <div className="grid grid-cols-4 border-b border-white/5">
          {[
            { label: 'Balance', value: balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), tone: 'text-white' },
            { label: 'Equity', value: equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), tone: equity > 0 ? 'text-white' : 'text-[#e5484d]' },
            { label: 'Margin', value: margin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), tone: 'text-white' },
            { label: 'Level', value: level, tone: 'text-white' },
          ].map((c) => (
            <div key={c.label} className="p-2 border-r border-white/5 last:border-0">
              <span className="text-[9px] uppercase tracking-wide text-zinc-500">{c.label}</span>
              <p className={`text-[13px] font-bold mt-px tabular-nums truncate ${c.tone}`}>{c.value}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-0.5 p-1 bg-black">
          {(
            [
              { id: 'positions', label: `Positions${openCount > 0 ? ` (${openCount})` : ''}` },
              { id: 'history', label: 'Closed Positions' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => {
                try {
                  haptic.selection();
                } catch {}
                setActiveTab(t.id);
              }}
              className={`flex-1 py-1 rounded-md text-[11px] font-semibold transition-all ${
                activeTab === t.id ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="px-2.5 pb-2.5 pt-1">
          {activeTab === 'positions' && (
            <div>
              {isLoading && positions.length === 0 && orders.length === 0 ? (
                <p className="text-[11px] text-zinc-500 text-center py-6">Loading account…</p>
              ) : positions.length === 0 && orders.length === 0 ? (
                <p className="text-[11px] text-zinc-500 text-center py-6 leading-relaxed">
                  No open positions. Tap any pair in Quotes to open the trade screen.
                </p>
              ) : (
                <div className="max-h-[320px] overflow-y-auto custom-scrollbar">
                  {positions.map((p, idx) => {
                    const tick = spotTicks[String(p.symbolId)];
                    return (
                      <CtraderPositionRow
                        key={`pos_${p.positionId ?? idx}`}
                        position={p}
                        symbolName={symbolNameFor(p, symbols)}
                        digits={digitsFor(Number(p.symbolId), symbols)}
                        liveBid={tick?.bid}
                        liveAsk={tick?.ask}
                        onClose={handleClosePosition}
                        onSaveSltp={handleSaveSltp}
                        onReconnect={onGoConnect}
                      />
                    );
                  })}
                  {orders.length > 0 && <p className="text-[10px] font-semibold text-zinc-500 pt-2 pb-0.5">Pending ({orders.length})</p>}
                  {orders.map((o: any, idx: number) => {
                    const trigger = o.limitPrice ?? o.stopPrice;
                    return (
                      <div key={`ord_${o.orderId ?? idx}`} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                        <div className="min-w-0 pr-3 flex-1">
                          <h3 className="text-[13px] font-bold uppercase tracking-tight leading-tight text-white truncate">
                            {o.symbol || symbolNameFor(o, symbols)}
                          </h3>
                          <p className="text-[11px] leading-tight mt-0.5 text-zinc-500 capitalize">
                            {o.tradeSide === 'sell' ? 'Sell' : 'Buy'} {String(o.orderType || '').replace('_', ' ')} · {Number(o.volume || 0).toFixed(2)}
                          </p>
                        </div>
                        <span className="text-[11px] font-semibold tabular-nums text-zinc-500 shrink-0">
                          {trigger !== undefined ? `@ ${trigger}` : 'Market'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              {error && <p className="text-[11px] font-medium text-rose-400 pt-1">{error}</p>}
            </div>
          )}

          {activeTab === 'history' && (
            <div>
              {deals.length === 0 ? (
                <p className="text-[11px] text-zinc-500 text-center py-6 leading-relaxed">No closed deals in the last 30 days.</p>
              ) : (
                <div className="max-h-[320px] overflow-y-auto custom-scrollbar">
                  {deals.map((d) => {
                    const net = Number(d.profit ?? 0) + Number(d.swap ?? 0) + Number(d.commission ?? 0);
                    const when = d.closeTimestamp ? new Date(d.closeTimestamp) : null;
                    return (
                      <div key={d.dealId} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                        <div className="min-w-0 pr-3 flex-1">
                          <h3 className="text-[13px] font-bold uppercase tracking-tight leading-tight text-white truncate">
                            {d.symbol || symbolNameFor(d, symbols)}
                          </h3>
                          <p className="text-[11px] leading-tight mt-0.5 text-zinc-500">
                            {d.tradeSide === 'sell' ? 'Short' : 'Long'} · {Number(d.volume || 0).toFixed(2)}
                            {when && !Number.isNaN(when.getTime())
                              ? ` · ${when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
                              : ''}
                          </p>
                        </div>
                        <span className={`text-[13px] font-bold tabular-nums shrink-0 ${net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {net > 0 ? '+' : ''}
                          {net.toFixed(2)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
