import React, { useEffect, useMemo, useState } from 'react';
import { Lock, LockOpen, Search, X } from 'lucide-react';
import { useCtraderSymbols } from '../../hooks/useCtraderSymbols';
import { useToast } from '../ui/Toast';
import { haptic } from '../../lib/haptics';
import type { Portfolio } from '../../types';
import {
  blankPortfolioLocks,
  cancelUnlockRequest,
  countOpensToday,
  dayKeyInTz,
  formatUnlockCountdown,
  isRuleActive,
  readLockStats,
  readPortfolioLocks,
  requestUnlock,
  unlockMsRemaining,
  writePortfolioLocks,
  type PortfolioLocks,
} from '../../lib/tradingLocks';

interface TradingLocksProps {
  portfolios: Portfolio[];
  activePortfolioId?: string | null;
  resolveCtraderAccountId: (portfolioId: string) => string | null;
  timezone?: string;
}

const ctraderPortfolios = (portfolios: Portfolio[]): Portfolio[] =>
  (portfolios || []).filter((p) => (p.source || 'manual') === 'ctrader' && !p.isArchived);

const Toggle: React.FC<{ on: boolean; onFlip: () => void; label: string }> = ({ on, onFlip, label }) => (
  <button
    type="button"
    onClick={() => {
      try {
        haptic.selection();
      } catch {}
      onFlip();
    }}
    role="switch"
    aria-checked={on}
    aria-label={label}
    style={{
      width: 48,
      height: 28,
      minWidth: 48,
      minHeight: 0,
      borderRadius: 9999,
      position: 'relative',
      flexShrink: 0,
      backgroundColor: on ? '#FF4F01' : '#3f3f46',
      border: 'none',
      cursor: 'pointer',
      padding: 0,
    }}
  >
    <div
      style={{
        position: 'absolute',
        top: 4,
        left: on ? 24 : 4,
        width: 20,
        height: 20,
        borderRadius: '50%',
        backgroundColor: '#ffffff',
        transition: 'left 0.2s ease',
        boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
      }}
    />
  </button>
);

const UnlockLine: React.FC<{ requestedAt: string | null; onCancel: () => void }> = ({ requestedAt, onCancel }) => {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!requestedAt || unlockMsRemaining(requestedAt) <= 0) return;
    const id = window.setInterval(() => tick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [requestedAt]);
  if (!requestedAt || unlockMsRemaining(requestedAt) <= 0) return null;
  return (
    <div className="mt-2 flex items-center justify-between gap-2 px-1">
      <p className="text-[11px] font-bold text-amber-300 tabular-nums">Unlocks in {formatUnlockCountdown(requestedAt)}</p>
      <button type="button" onClick={onCancel} className="text-[11px] font-black text-amber-200 underline active:scale-95">
        Cancel
      </button>
    </div>
  );
};

/**
 * Per-portfolio trading locks: pair whitelist, max trades/day, lot guard.
 * Disabling an active rule starts a 24h cooling countdown instead of
 * unlocking immediately. Closes and SL/TP edits are never gated.
 */
export const TradingLocks: React.FC<TradingLocksProps> = ({
  portfolios,
  activePortfolioId,
  resolveCtraderAccountId,
  timezone,
}) => {
  const options = useMemo(() => ctraderPortfolios(portfolios), [portfolios]);
  const [selectedPid, setSelectedPid] = useState<string | null>(activePortfolioId ?? options[0]?.id ?? null);
  useEffect(() => {
    if (!selectedPid && (activePortfolioId || options[0]?.id)) setSelectedPid(activePortfolioId ?? options[0]?.id ?? null);
  }, [activePortfolioId, options, selectedPid]);

  const [locks, setLocks] = useState<PortfolioLocks>(() => readPortfolioLocks(selectedPid));
  useEffect(() => {
    setLocks(readPortfolioLocks(selectedPid));
  }, [selectedPid]);

  const persist = (next: PortfolioLocks) => {
    setLocks(next);
    if (!selectedPid) return;
    writePortfolioLocks(selectedPid, next);
    // Cloud mirror for server-side enforcement (best-effort, never blocks).
    void import('../../services/dataService')
      .then((m) => m.dataService.savePortfolioLocks(selectedPid, next))
      .catch(() => {});
  };

  const accountId = selectedPid ? resolveCtraderAccountId(selectedPid) : null;
  const { symbols, isLoading: symbolsLoading, isDemo } = useCtraderSymbols(accountId);

  const [fillsToday, setFillsToday] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    setFillsToday(null);
    if (!accountId) return;
    void countOpensToday(accountId, isDemo, timezone).then((n) => {
      if (!cancelled) setFillsToday(n);
    });
    return () => {
      cancelled = true;
    };
  }, [accountId, isDemo, timezone]);

  const [query, setQuery] = useState('');
  // Pair picker visibility: once pairs are chosen the long select list
  // collapses away and the card shows just the selected pairs.
  const [pairPickerOpen, setPairPickerOpen] = useState(false);
  // Same collapse pattern for the numeric editors: chosen values display
  // read-only, inputs only open for editing.
  const [maxEditOpen, setMaxEditOpen] = useState(false);
  const [lotEditOpen, setLotEditOpen] = useState(false);
  useEffect(() => {
    setPairPickerOpen(readPortfolioLocks(selectedPid).pairWhitelist.symbolIds.length === 0);
  }, [selectedPid]);
  useEffect(() => {
    if (locks.pairWhitelist.symbolIds.length === 0) setPairPickerOpen(true);
  }, [locks.pairWhitelist.symbolIds.length]);
  // Raw text for the lot inputs: the field shows exactly what is typed
  // (so "0.01" is typeable) while the parsed number commits to the lock.
  const [minRaw, setMinRaw] = useState('');
  const [maxRaw, setMaxRaw] = useState('');
  useEffect(() => {
    setMinRaw(locks.lotGuard.minLots !== undefined ? String(locks.lotGuard.minLots) : '');
    setMaxRaw(locks.lotGuard.maxLots !== undefined ? String(locks.lotGuard.maxLots) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPid]);

  const commitLot = (which: 'minLots' | 'maxLots', text: string) => {
    // Keep first dot only; display keeps raw text, lock gets the number.
    const parts = text.replace(/[^0-9.]/g, '').split('.');
    const clean = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : parts.join('.');
    if (which === 'minLots') setMinRaw(text.replace(/[^0-9.]/g, ''));
    else setMaxRaw(text.replace(/[^0-9.]/g, ''));
    const v = clean === '' || clean === '.' ? undefined : Number(clean);
    persist({
      ...locks,
      lotGuard: { ...locks.lotGuard, [which]: v !== undefined && Number.isFinite(v) ? v : undefined },
    });
  };
  const filteredSymbols = useMemo(() => {
    const q = query.trim().toUpperCase();
    const list = q ? symbols.filter((s) => s.symbolName.toUpperCase().includes(q)) : symbols;
    return list.slice(0, 60);
  }, [symbols, query]);

  const stats = selectedPid ? readLockStats(selectedPid, dayKeyInTz(Date.now(), timezone)) : { blocks: 0, fills: 0 };

  const selectedPortfolio = options.find((p) => p.id === selectedPid) ?? null;

  const { addToast } = useToast();

  const flip = (key: 'pairWhitelist' | 'maxTrades' | 'lotGuard') => {
    const rule = locks[key] as { enabled: boolean; unlockRequestedAt: string | null };
    if (!rule.enabled) {
      // Guards: never enable a lock that would block 100% of trading —
      // open the editor instead so the missing setup can be completed.
      if (key === 'pairWhitelist' && locks.pairWhitelist.symbolIds.length === 0) {
        setPairPickerOpen(true);
        addToast({ type: 'info', title: 'Select pairs first', message: 'Tick at least 1 pair below, then switch the lock on.', duration: 4000 });
        return;
      }
      if (key === 'lotGuard' && locks.lotGuard.minLots === undefined && locks.lotGuard.maxLots === undefined) {
        setLotEditOpen(true);
        addToast({ type: 'info', title: 'Set a limit first', message: 'Enter a min and/or max lot size below, then switch the lock on.', duration: 4000 });
        return;
      }
      persist({ ...locks, [key]: { ...locks[key], enabled: true, unlockRequestedAt: null } } as PortfolioLocks);
      if (key === 'pairWhitelist') setPairPickerOpen(false);
      if (key === 'lotGuard') setLotEditOpen(false);
      if (key === 'maxTrades') setMaxEditOpen(false);
    } else if (!rule.unlockRequestedAt) {
      // Turning off starts cooling — the rule STAYS binding until it elapses.
      persist({ ...locks, [key]: requestUnlock({ ...locks[key] }) } as PortfolioLocks);
    } else {
      persist({ ...locks, [key]: cancelUnlockRequest({ ...locks[key] }) } as PortfolioLocks);
    }
  };

  const toggleSymbol = (id: number, name: string) => {
    try {
      haptic.selection();
    } catch {}
    const ids = locks.pairWhitelist.symbolIds.map(Number);
    const has = ids.includes(Number(id));
    const nextIds = has ? ids.filter((x) => x !== Number(id)) : [...ids, Number(id)];
    const names = { ...locks.pairWhitelist.symbolNames };
    if (has) delete names[Number(id)];
    else names[Number(id)] = name;
    persist({ ...locks, pairWhitelist: { ...locks.pairWhitelist, symbolIds: nextIds, symbolNames: names } });
  };

  if (options.length === 0) return null;

  const wlActive = isRuleActive(locks.pairWhitelist);
  const mtActive = isRuleActive(locks.maxTrades);
  const lgActive = isRuleActive(locks.lotGuard);

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 mb-2 px-1">
        <Lock size={14} className="text-[#FF4F01]" />
        <h2 className="text-[13px] font-black uppercase tracking-widest text-white">Trading Locks</h2>
      </div>
      <p className="text-[11px] text-zinc-500 px-1 mb-3 leading-relaxed">
        Hard limits for this portfolio. Switching a lock off keeps it enforced for a 24h cooling countdown — closes and SL/TP edits always keep working.
      </p>

      {options.length > 1 && (
        <div className="mb-3">
          <label htmlFor="locks-portfolio" className="sr-only">
            Portfolio for trading locks
          </label>
          <select
            id="locks-portfolio"
            value={selectedPid ?? ''}
            onChange={(e) => setSelectedPid(e.target.value || null)}
            className="w-full h-11 rounded-xl border bg-[#0a0a0a] border-zinc-800/80 px-3 text-[13px] font-bold text-white outline-none focus:border-[#FF4F01]"
          >
            {options.map((p) => (
              <option key={p.id} value={p.id} className="bg-black">
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Pair whitelist */}
      <div className="p-4 rounded-2xl border bg-[#0a0a0a] border-zinc-800/80 mb-2.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[13px] font-black text-white">Allowed pairs</p>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              {wlActive ? `${locks.pairWhitelist.symbolIds.length} pair(s) · others locked` : 'Trade any pair'}
            </p>
          </div>
          <Toggle on={wlActive} onFlip={() => flip('pairWhitelist')} label="Toggle allowed pairs lock" />
        </div>
        {(locks.pairWhitelist.enabled || pairPickerOpen) && (
          <div className="mt-3">
            {/* Chosen pairs — always visible once selected. */}
            {locks.pairWhitelist.symbolIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {locks.pairWhitelist.symbolIds.map((id) => (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1.5 rounded-lg bg-[#FF4F01]/15 text-[#FF4F01] text-[12px] font-bold"
                  >
                    {locks.pairWhitelist.symbolNames[Number(id)] || symbols.find((s) => Number(s.symbolId) === Number(id))?.symbolName || `#${id}`}
                    <button
                      type="button"
                      onClick={() =>
                        toggleSymbol(Number(id), locks.pairWhitelist.symbolNames[Number(id)] || String(id))
                      }
                      aria-label={`Remove pair ${locks.pairWhitelist.symbolNames[Number(id)] || id}`}
                      className="w-5 h-5 rounded-md flex items-center justify-center active:scale-95 text-[#FF4F01]/70"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                try {
                  haptic.selection();
                } catch {}
                setPairPickerOpen((v) => !v);
              }}
              className="w-full h-10 rounded-lg border border-dashed border-zinc-700 text-zinc-300 text-[12px] font-bold active:scale-[0.99] transition-all mb-2"
            >
              {pairPickerOpen
                ? 'Done'
                : locks.pairWhitelist.symbolIds.length > 0
                  ? `Edit pairs (${locks.pairWhitelist.symbolIds.length} selected)`
                  : 'Select pairs'}
            </button>
            {pairPickerOpen && (
              <>
                <div className="relative mb-2">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search pairs…"
                    aria-label="Search pairs"
                    className="w-full h-10 rounded-lg border bg-[#000000] border-[#27272a] pl-8 pr-3 text-[12px] text-white placeholder:text-zinc-600 outline-none focus:border-[#FF4F01]"
                  />
                </div>
                <div className="max-h-44 overflow-y-auto no-scrollbar space-y-1">
                  {symbolsLoading && symbols.length === 0 && <p className="text-[11px] text-zinc-600 py-2">Loading pairs…</p>}
                  {!symbolsLoading && symbols.length === 0 && (
                    <p className="text-[11px] text-zinc-600 py-2">Connect this portfolio to pick pairs.</p>
                  )}
                  {filteredSymbols.map((s) => {
                    const checked = locks.pairWhitelist.symbolIds.map(Number).includes(Number(s.symbolId));
                    return (
                      <button
                        key={s.symbolId}
                        type="button"
                        onClick={() => toggleSymbol(s.symbolId, s.symbolName)}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[12px] font-bold transition-all active:scale-[0.99] ${
                          checked ? 'bg-[#FF4F01]/15 text-[#FF4F01]' : 'text-zinc-400'
                        }`}
                      >
                        <span>{s.symbolName}</span>
                        <span
                          className={`w-5 h-5 rounded-md border flex items-center justify-center text-[12px] ${
                            checked ? 'bg-[#FF4F01] border-[#FF4F01] text-white' : 'border-zinc-700 text-transparent'
                          }`}
                        >
                          ✓
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            <UnlockLine
              requestedAt={locks.pairWhitelist.unlockRequestedAt}
              onCancel={() => persist({ ...locks, pairWhitelist: cancelUnlockRequest(locks.pairWhitelist) })}
            />
          </div>
        )}
      </div>

      {/* Max trades per day */}
      <div className="p-4 rounded-2xl border bg-[#0a0a0a] border-zinc-800/80 mb-2.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[13px] font-black text-white">Max trades per day</p>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              {mtActive
                ? `${fillsToday === null ? '…' : fillsToday}/${locks.maxTrades.maxPerDay} used today`
                : 'Unlimited'} · {stats.blocks > 0 ? `${stats.blocks} blocked today` : 'closes never blocked'}
            </p>
          </div>
          <Toggle on={mtActive} onFlip={() => flip('maxTrades')} label="Toggle max trades per day lock" />
        </div>
        {locks.maxTrades.enabled && (
          <div className="mt-3">
            {!maxEditOpen ? (
              <div className="flex items-center justify-between">
                <p className="text-[12px] font-bold text-zinc-300">
                  Limit <span className="text-[#FF4F01] tabular-nums">{locks.maxTrades.maxPerDay}</span> per day
                </p>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      haptic.selection();
                    } catch {}
                    setMaxEditOpen(true);
                  }}
                  className="text-[11px] font-black text-[#FF4F01] active:scale-95"
                >
                  Edit
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <label htmlFor="locks-max-trades" className="text-[11px] font-bold text-zinc-500">
                  Limit
                </label>
                <input
                  id="locks-max-trades"
                  type="number"
                  min={1}
                  max={50}
                  value={locks.maxTrades.maxPerDay}
                  onChange={(e) => {
                    const v = Math.max(1, Math.min(50, Math.floor(Number(e.target.value) || 1)));
                    persist({ ...locks, maxTrades: { ...locks.maxTrades, maxPerDay: v } });
                  }}
                  className="w-20 h-10 rounded-lg border bg-[#000000] border-[#27272a] px-2.5 text-[13px] font-bold tabular-nums text-white outline-none focus:border-[#FF4F01]"
                />
                <button
                  type="button"
                  onClick={() => {
                    try {
                      haptic.selection();
                    } catch {}
                    setMaxEditOpen(false);
                  }}
                  className="h-10 px-4 rounded-lg bg-[#FF4F01]/15 text-[#FF4F01] text-[12px] font-bold active:scale-95 transition-all"
                >
                  Done
                </button>
              </div>
            )}
            <UnlockLine
              requestedAt={locks.maxTrades.unlockRequestedAt}
              onCancel={() => persist({ ...locks, maxTrades: cancelUnlockRequest(locks.maxTrades) })}
            />
          </div>
        )}
      </div>

      {/* Lot guard */}
      <div className="p-4 rounded-2xl border bg-[#0a0a0a] border-zinc-800/80">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[13px] font-black text-white">Lot size limits</p>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              {lgActive
                ? `Allowed ${locks.lotGuard.minLots ?? '…'}–${locks.lotGuard.maxLots ?? '…'} lots`
                : 'Any size'}
            </p>
          </div>
          <Toggle on={lgActive} onFlip={() => flip('lotGuard')} label="Toggle lot size lock" />
        </div>
        {(locks.lotGuard.enabled || lotEditOpen) && (
          <div className="mt-3">
            {!lotEditOpen ? (
              <div className="flex items-center justify-between">
                <p className="text-[12px] font-bold text-zinc-300">
                  Min <span className="text-[#FF4F01] tabular-nums">{locks.lotGuard.minLots ?? '—'}</span>
                  {' · '}
                  Max <span className="text-[#FF4F01] tabular-nums">{locks.lotGuard.maxLots ?? '—'}</span>
                </p>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      haptic.selection();
                    } catch {}
                    setLotEditOpen(true);
                  }}
                  className="text-[11px] font-black text-[#FF4F01] active:scale-95"
                >
                  Edit
                </button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="locks-min-lot" className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">
                      Min lots
                    </label>
                    <input
                      id="locks-min-lot"
                      inputMode="decimal"
                      placeholder="e.g. 0.01"
                      value={minRaw}
                      onChange={(e) => commitLot('minLots', e.target.value)}
                      className="w-full h-10 rounded-lg border bg-[#000000] border-[#27272a] px-2.5 text-[13px] tabular-nums text-white placeholder:text-zinc-600 outline-none focus:border-[#FF4F01]"
                    />
                  </div>
                  <div>
                    <label htmlFor="locks-max-lot" className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">
                      Max lots
                    </label>
                    <input
                      id="locks-max-lot"
                      inputMode="decimal"
                      placeholder="e.g. 0.50"
                      value={maxRaw}
                      onChange={(e) => commitLot('maxLots', e.target.value)}
                      className="w-full h-10 rounded-lg border bg-[#000000] border-[#27272a] px-2.5 text-[13px] tabular-nums text-white placeholder:text-zinc-600 outline-none focus:border-[#FF4F01]"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      haptic.selection();
                    } catch {}
                    setLotEditOpen(false);
                  }}
                  className="mt-2 w-full h-10 rounded-lg bg-[#FF4F01]/15 text-[#FF4F01] text-[12px] font-bold active:scale-[0.99] transition-all"
                >
                  Done
                </button>
              </>
            )}
            <UnlockLine
              requestedAt={locks.lotGuard.unlockRequestedAt}
              onCancel={() => persist({ ...locks, lotGuard: cancelUnlockRequest(locks.lotGuard) })}
            />
          </div>
        )}
      </div>

      {selectedPortfolio && (
        <p className="text-[10px] text-zinc-600 px-1 mt-2 leading-relaxed">
          Locks apply to {selectedPortfolio.name}. {isRuleActive(locks.pairWhitelist) || isRuleActive(locks.maxTrades) || isRuleActive(locks.lotGuard) ? (
            <span className="inline-flex items-center gap-1 text-amber-300 font-bold"><LockOpen size={10} /> Enforced on new orders.</span>
          ) : (
            'No active locks.'
          )}
        </p>
      )}
    </div>
  );
};
