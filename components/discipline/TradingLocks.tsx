import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Lock, Search, X } from 'lucide-react';
import ConfirmationModal from '../ConfirmationModal';
import { useCtraderSymbols } from '../../hooks/useCtraderSymbols';
import { useToast } from '../ui/Toast';
import { haptic } from '../../lib/haptics';
import type { Portfolio } from '../../types';
import {
  blankPortfolioLocks,
  cancelPendingChange,
  cancelUnlockRequest,
  countOpensToday,
  dayKeyInTz,
  editLotGuard,
  editMaxTrades,
  editPairWhitelist,
  formatUnlockCountdown,
  isRuleActive,
  normalizePortfolioLocks,
  pairCountLabel,
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
  onGoConnect?: () => void;
}

type RuleKey = 'pairWhitelist' | 'maxTrades' | 'lotGuard';

const RULE_NAMES: Record<RuleKey, string> = {
  pairWhitelist: 'Allowed pairs',
  maxTrades: 'Max trades per day',
  lotGuard: 'Lot size limits',
};

const ctraderPortfolios = (portfolios: Portfolio[]): Portfolio[] =>
  (portfolios || []).filter((p) => (p.source || 'manual') === 'ctrader' && !p.isArchived);

const hasConfiguredLocks = (locks: PortfolioLocks): boolean =>
  locks.pairWhitelist.enabled ||
  locks.maxTrades.enabled ||
  locks.lotGuard.enabled ||
  !!locks.pairWhitelist.pendingChange ||
  !!locks.maxTrades.pendingChange ||
  !!locks.lotGuard.pendingChange ||
  locks.pairWhitelist.symbolIds.length > 0 ||
  locks.lotGuard.minLots !== undefined ||
  locks.lotGuard.maxLots !== undefined ||
  locks.maxTrades.maxPerDay !== 2;

const cleanDecimal = (text: string): string => {
  const parts = text.replace(/[^0-9.]/g, '').split('.');
  return parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : parts.join('.');
};

const parseDecimal = (raw: string): number | undefined => {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '.') return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
};

const lotRangeError = (min: number | undefined, max: number | undefined, requireOne: boolean): string | null => {
  if (min !== undefined && (min <= 0 || min > 100)) return 'Each lot limit must be above 0 and at most 100.';
  if (max !== undefined && (max <= 0 || max > 100)) return 'Each lot limit must be above 0 and at most 100.';
  if (min !== undefined && max !== undefined && min > max) return 'Min lots can’t be above max lots.';
  if (requireOne && min === undefined && max === undefined) return 'Enter a min and/or max lot size.';
  return null;
};

const Toggle: React.FC<{
  on: boolean;
  cooling?: boolean;
  onFlip: () => void;
  label: string;
  disabled?: boolean;
}> = ({ on, cooling = false, onFlip, label, disabled = false }) => (
  <button
    type="button"
    onClick={() => {
      if (disabled) return;
      try {
        haptic.selection();
      } catch {}
      onFlip();
    }}
    role="switch"
    aria-checked={on}
    aria-disabled={disabled}
    aria-label={label}
    disabled={disabled}
    style={{
      width: 48,
      height: 28,
      minWidth: 48,
      minHeight: 0,
      borderRadius: 9999,
      position: 'relative',
      flexShrink: 0,
      backgroundColor: cooling ? '#f59e0b' : on ? '#FF4F01' : '#3f3f46',
      border: 'none',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.45 : 1,
      padding: 0,
    }}
  >
    <div
      style={{
        position: 'absolute',
        top: 4,
        left: cooling ? 14 : on ? 24 : 4,
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

const CountdownLine: React.FC<{ requestedAt: string | null | undefined; label: string; onCancel: () => void }> = ({
  requestedAt,
  label,
  onCancel,
}) => {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!requestedAt || unlockMsRemaining(requestedAt) <= 0) return;
    const id = window.setInterval(() => tick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [requestedAt]);
  if (!requestedAt || unlockMsRemaining(requestedAt) <= 0) return null;
  return (
    <div className="mt-2 flex items-center justify-between gap-2 px-1">
      <p className="text-[11px] font-bold text-amber-300 tabular-nums">
        {label} {formatUnlockCountdown(requestedAt)}
      </p>
      <button type="button" onClick={onCancel} className="text-[11px] font-black text-amber-200 underline active:scale-95">
        Cancel
      </button>
    </div>
  );
};

const TradingLocksHeader: React.FC = () => (
  <div className="flex items-center gap-2 mb-2 px-1">
    <Lock size={14} className="text-[#FF4F01]" />
    <h2 className="text-[13px] font-black uppercase tracking-widest text-white">Trading Locks</h2>
  </div>
);

type ConfirmState = { kind: 'off' | 'keep'; key: RuleKey } | null;

/**
 * Per-portfolio trading locks: pair whitelist, max trades/day, lot guard.
 * Disabling an active rule starts a 24h cooling countdown instead of
 * unlocking immediately. Loosening an active rule also waits 24h, while
 * tightening applies now. Closes and SL/TP edits are never gated.
 */
export const TradingLocks: React.FC<TradingLocksProps> = ({
  portfolios,
  activePortfolioId,
  resolveCtraderAccountId,
  timezone,
  onGoConnect,
}) => {
  const options = useMemo(() => ctraderPortfolios(portfolios), [portfolios]);
  const [selectedPid, setSelectedPid] = useState<string | null>(activePortfolioId ?? options[0]?.id ?? null);
  useEffect(() => {
    if (options.length === 0) {
      if (selectedPid) setSelectedPid(null);
      return;
    }
    if (!selectedPid || !options.some((p) => p.id === selectedPid)) {
      setSelectedPid(activePortfolioId ?? options[0]?.id ?? null);
    }
  }, [activePortfolioId, options, selectedPid]);

  const [locks, setLocks] = useState<PortfolioLocks>(() => readPortfolioLocks(selectedPid));
  const [syncFailed, setSyncFailed] = useState(false);
  const syncSeq = useRef(0);
  // Bumped on every local edit so an in-flight cloud load can never clobber
  // (or push a stale copy over) a change the user just made.
  const persistSeq = useRef(0);

  const saveToCloud = useCallback(async (pid: string, next: PortfolioLocks) => {
    const seq = ++syncSeq.current;
    try {
      const m = await import('../../services/dataService');
      await m.dataService.savePortfolioLocks(pid, next);
      if (seq === syncSeq.current) setSyncFailed(false);
    } catch {
      if (seq === syncSeq.current) setSyncFailed(true);
    }
  }, []);

  const persist = useCallback(
    (next: PortfolioLocks) => {
      if (!selectedPid) return;
      persistSeq.current += 1;
      const stamped = { ...next, updatedAt: new Date().toISOString() };
      setLocks(stamped);
      writePortfolioLocks(selectedPid, stamped);
      void saveToCloud(selectedPid, stamped);
    },
    [selectedPid, saveToCloud]
  );

  // Load cloud first, fall back to the local cache, and keep the newest copy.
  useEffect(() => {
    let alive = true;
    setSyncFailed(false);
    if (!selectedPid) {
      setLocks(blankPortfolioLocks());
      return () => {
        alive = false;
      };
    }
    const local = readPortfolioLocks(selectedPid);
    setLocks(local);
    const loadSeq = persistSeq.current;
    void (async () => {
      try {
        const m = await import('../../services/dataService');
        const remote = await m.dataService.loadPortfolioLocks(selectedPid);
        if (!alive || persistSeq.current !== loadSeq) return;
        if (!remote) {
          if (hasConfiguredLocks(local)) void saveToCloud(selectedPid, local);
          return;
        }
        const currentLocal = readPortfolioLocks(selectedPid);
        const remoteAt = Date.parse(remote.updatedAt || '') || 0;
        const localAt = Date.parse(currentLocal.updatedAt || '') || 0;
        if (remoteAt > localAt) {
          const normalized = normalizePortfolioLocks(remote);
          writePortfolioLocks(selectedPid, normalized);
          setLocks(normalized);
        } else if (localAt > remoteAt) {
          void saveToCloud(selectedPid, currentLocal);
        }
      } catch {
        // Cloud unreachable: keep using the local cache.
      }
    })();
    return () => {
      alive = false;
    };
  }, [selectedPid, saveToCloud]);

  // Merge elapsed pending changes / expiring cooling counts while mounted.
  useEffect(() => {
    if (!selectedPid) return;
    const now = Date.now();
    const waits: number[] = [];
    for (const rule of [locks.pairWhitelist, locks.maxTrades, locks.lotGuard]) {
      if (rule.unlockRequestedAt) {
        const ms = unlockMsRemaining(rule.unlockRequestedAt, now);
        if (ms > 0) waits.push(ms);
      }
      if (rule.pendingChange?.requestedAt) {
        const ms = unlockMsRemaining(rule.pendingChange.requestedAt, now);
        if (ms > 0) waits.push(ms);
      }
    }
    if (waits.length === 0) return;
    const id = window.setTimeout(() => {
      const normalized = normalizePortfolioLocks(locks);
      if (JSON.stringify(normalized) !== JSON.stringify(locks)) {
        persistSeq.current += 1;
        setLocks(normalized);
        writePortfolioLocks(selectedPid, normalized);
        // Keep the server-side mirror current when a cooling countdown or a
        // pending loosening lands while this screen is open.
        void saveToCloud(selectedPid, normalized);
      }
    }, Math.min(...waits) + 50);
    return () => window.clearTimeout(id);
  }, [locks, selectedPid, saveToCloud]);

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

  const [serverBlocks, setServerBlocks] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    setServerBlocks(null);
    if (!selectedPid) return;
    void import('../../services/dataService')
      .then((m) => m.dataService.countLockBlocksToday(selectedPid, timezone))
      .then((n) => {
        if (!cancelled) setServerBlocks(n);
      })
      .catch(() => {
        if (!cancelled) setServerBlocks(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPid, timezone]);

  const [query, setQuery] = useState('');
  // Pair picker visibility: once pairs are chosen the long select list
  // collapses away and the card shows just the selected pairs.
  const [pairPickerOpen, setPairPickerOpen] = useState(false);
  // Same collapse pattern for the numeric editors: chosen values display
  // read-only, inputs only open for editing.
  const [maxEditOpen, setMaxEditOpen] = useState(false);
  const [lotEditOpen, setLotEditOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  useEffect(() => {
    setPairPickerOpen(false);
    setMaxEditOpen(false);
    setLotEditOpen(false);
    setQuery('');
    setConfirm(null);
  }, [selectedPid]);

  // Raw text for the numeric inputs: the field shows exactly what is typed
  // (so "0.01" is typeable) while the parsed number commits on Done.
  const [minRaw, setMinRaw] = useState('');
  const [maxRaw, setMaxRaw] = useState('');
  const [maxTradesRaw, setMaxTradesRaw] = useState('');

  const openLotEditor = () => {
    setMinRaw(locks.lotGuard.minLots !== undefined ? String(locks.lotGuard.minLots) : '');
    setMaxRaw(locks.lotGuard.maxLots !== undefined ? String(locks.lotGuard.maxLots) : '');
    setLotEditOpen(true);
  };

  const openMaxTradesEditor = () => {
    setMaxTradesRaw(String(locks.maxTrades.maxPerDay || 2));
    setMaxEditOpen(true);
  };

  const selectedMin = parseDecimal(minRaw);
  const selectedMax = parseDecimal(maxRaw);
  const lotError = lotRangeError(selectedMin, selectedMax, !isRuleActive(locks.lotGuard));
  const storedLotError = lotRangeError(locks.lotGuard.minLots, locks.lotGuard.maxLots, false);

  const maxTradesValue = Number(maxTradesRaw);
  const maxTradesError =
    maxTradesRaw.trim() === ''
      ? 'Enter a limit between 1 and 50.'
      : !/^\d+$/.test(maxTradesRaw.trim()) || !Number.isFinite(maxTradesValue) || maxTradesValue < 1 || maxTradesValue > 50
        ? 'Limit must be a whole number from 1 to 50.'
        : null;

  const commitMaxTrades = () => {
    if (maxTradesError) return;
    const wasOff = !isRuleActive(locks.maxTrades);
    let nextRule = editMaxTrades(locks.maxTrades, Math.floor(maxTradesValue));
    if (wasOff) nextRule = { ...nextRule, enabled: true, unlockRequestedAt: null, pendingChange: null };
    persist({ ...locks, maxTrades: nextRule });
    setMaxEditOpen(false);
  };

  const commitLots = () => {
    if (lotError) return;
    const wasOff = !isRuleActive(locks.lotGuard);
    const desired: { minLots?: number | null; maxLots?: number | null } = {};
    if (selectedMin !== locks.lotGuard.minLots) desired.minLots = selectedMin ?? null;
    if (selectedMax !== locks.lotGuard.maxLots) desired.maxLots = selectedMax ?? null;
    if (Object.keys(desired).length === 0) {
      if (wasOff) {
        persist({ ...locks, lotGuard: { ...locks.lotGuard, enabled: true, unlockRequestedAt: null, pendingChange: null } });
      }
      setLotEditOpen(false);
      return;
    }
    let nextRule = editLotGuard(locks.lotGuard, desired);
    if (wasOff) nextRule = { ...nextRule, enabled: true, unlockRequestedAt: null, pendingChange: null };
    persist({ ...locks, lotGuard: nextRule });
    setLotEditOpen(false);
  };

  const filteredSymbols = useMemo(() => {
    const q = query.trim().toUpperCase();
    const list = q ? symbols.filter((s) => s.symbolName.toUpperCase().includes(q)) : symbols;
    return list.slice(0, 60);
  }, [symbols, query]);

  const stats = selectedPid ? readLockStats(selectedPid, dayKeyInTz(Date.now(), timezone)) : { blocks: 0, fills: 0 };
  const blocksToday = serverBlocks ?? stats.blocks;

  const selectedPortfolio = options.find((p) => p.id === selectedPid) ?? null;

  const { addToast } = useToast();

  const flip = (key: RuleKey) => {
    const rule = locks[key] as { enabled: boolean; unlockRequestedAt: string | null };
    const active = isRuleActive(rule);
    if (!active) {
      // Max trades is a visible choice: open the editor (prefilled with 2)
      // instead of silently enabling a default. A second tap backs out.
      if (key === 'maxTrades') {
        if (maxEditOpen) {
          setMaxEditOpen(false);
          return;
        }
        openMaxTradesEditor();
        return;
      }
      // Guards: never enable a lock that would block 100% of trading —
      // open the editor instead so the missing setup can be completed.
      if (key === 'pairWhitelist' && locks.pairWhitelist.symbolIds.length === 0) {
        if (pairPickerOpen) {
          setPairPickerOpen(false);
          return;
        }
        setPairPickerOpen(true);
        addToast({ type: 'info', title: 'Select pairs first', message: 'Tick at least 1 pair below, then switch the lock on.', duration: 4000 });
        return;
      }
      if (key === 'lotGuard') {
        if (lotEditOpen) {
          setLotEditOpen(false);
          return;
        }
        if (locks.lotGuard.minLots === undefined && locks.lotGuard.maxLots === undefined) {
          openLotEditor();
          addToast({ type: 'info', title: 'Set a limit first', message: 'Enter a min and/or max lot size below, then switch the lock on.', duration: 4000 });
          return;
        }
        if (storedLotError) {
          openLotEditor();
          addToast({ type: 'error', title: 'Fix the lot limits', message: storedLotError, duration: 4000 });
          return;
        }
      }
      persist({ ...locks, [key]: { ...locks[key], enabled: true, unlockRequestedAt: null, pendingChange: null } } as PortfolioLocks);
      if (key === 'pairWhitelist') setPairPickerOpen(false);
      if (key === 'lotGuard') setLotEditOpen(false);
      return;
    }

    if (rule.unlockRequestedAt) {
      setConfirm({ kind: 'keep', key });
    } else {
      setConfirm({ kind: 'off', key });
    }
  };

  const applyConfirm = () => {
    if (!confirm) return;
    const key = confirm.key;
    if (confirm.kind === 'off') {
      persist({ ...locks, [key]: requestUnlock({ ...locks[key] }) } as PortfolioLocks);
      setPairPickerOpen(false);
      setMaxEditOpen(false);
      setLotEditOpen(false);
    } else {
      persist({ ...locks, [key]: cancelUnlockRequest({ ...locks[key] }) } as PortfolioLocks);
    }
    setConfirm(null);
  };

  const currentPairIds = locks.pairWhitelist.symbolIds.map(Number);
  const pendingPair = locks.pairWhitelist.pendingChange;
  const displayPairIds = pendingPair && Array.isArray(pendingPair.value?.symbolIds)
    ? pendingPair.value.symbolIds.map(Number)
    : currentPairIds;
  const displayPairNames = { ...locks.pairWhitelist.symbolNames, ...(pendingPair?.value?.symbolNames || {}) };

  const toggleSymbol = (id: number, name: string) => {
    try {
      haptic.selection();
    } catch {}
    const numericId = Number(id);
    const active = isRuleActive(locks.pairWhitelist);
    const has = displayPairIds.includes(numericId);
    if (has && active && currentPairIds.includes(numericId) && currentPairIds.length === 1) {
      addToast({ type: 'info', title: 'Keep one pair', message: 'At least one pair must stay allowed while the lock is on.', duration: 4000 });
      return;
    }
    const nextIds = has ? displayPairIds.filter((x) => x !== numericId) : [...displayPairIds, numericId];
    const names = { ...displayPairNames };
    if (has) delete names[numericId];
    else names[numericId] = name;
    const nextRule = editPairWhitelist(locks.pairWhitelist, { symbolIds: nextIds, symbolNames: names });
    persist({ ...locks, pairWhitelist: nextRule });
  };

  if (options.length === 0) {
    return (
      <div className="mt-4">
        <TradingLocksHeader />
        <div className="p-4 rounded-2xl border bg-[#0a0a0a] border-zinc-800/80">
          <p className="text-[12px] text-zinc-400">Locks need a connected cTrader portfolio.</p>
          <button
            type="button"
            onClick={() => {
              try {
                haptic.selection();
              } catch {}
              onGoConnect?.();
            }}
            className="mt-3 h-10 px-4 rounded-lg bg-[#FF4F01] text-white text-[12px] font-bold active:scale-95 transition-all"
          >
            Connect cTrader
          </button>
        </div>
      </div>
    );
  }

  const wlActive = isRuleActive(locks.pairWhitelist);
  const mtActive = isRuleActive(locks.maxTrades);
  const lgActive = isRuleActive(locks.lotGuard);
  const wlCooling = !!locks.pairWhitelist.unlockRequestedAt && unlockMsRemaining(locks.pairWhitelist.unlockRequestedAt) > 0;
  const mtCooling = !!locks.maxTrades.unlockRequestedAt && unlockMsRemaining(locks.maxTrades.unlockRequestedAt) > 0;
  const lgCooling = !!locks.lotGuard.unlockRequestedAt && unlockMsRemaining(locks.lotGuard.unlockRequestedAt) > 0;
  const anyActive = wlActive || mtActive || lgActive;

  return (
    <div className="mt-4">
      <TradingLocksHeader />
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

      {syncFailed && (
        <div className="mb-2.5 flex items-center justify-between gap-2 px-1">
          <p className="text-[11px] font-bold text-amber-300">Not synced: locks only apply on this device</p>
          <button
            type="button"
            onClick={() => {
              if (selectedPid) void saveToCloud(selectedPid, locks);
            }}
            className="text-[11px] font-black text-amber-200 underline active:scale-95"
          >
            Retry
          </button>
        </div>
      )}

      {/* Pair whitelist */}
      <div className="p-4 rounded-2xl border bg-[#0a0a0a] border-zinc-800/80 mb-2.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[13px] font-black text-white">Allowed pairs</p>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              {wlActive ? `${pairCountLabel(currentPairIds.length)} · others locked` : 'Trade any pair'}
            </p>
          </div>
          <Toggle on={wlActive} cooling={wlCooling} onFlip={() => flip('pairWhitelist')} label="Toggle allowed pairs lock" />
        </div>
        {(locks.pairWhitelist.enabled || pairPickerOpen) && (
          <div className="mt-3">
            {/* Chosen pairs — pending additions show amber until they apply. */}
            {displayPairIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {displayPairIds.map((id) => {
                  const pendingOnly = !currentPairIds.includes(id) && wlActive;
                  const name =
                    displayPairNames[Number(id)] ||
                    symbols.find((s) => Number(s.symbolId) === Number(id))?.symbolName ||
                    `#${id}`;
                  const canRemove = !(wlActive && currentPairIds.includes(id) && currentPairIds.length === 1);
                  return (
                    <span
                      key={id}
                      className={`inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1.5 rounded-lg text-[12px] font-bold ${
                        pendingOnly ? 'bg-amber-500/15 text-amber-300' : 'bg-[#FF4F01]/15 text-[#FF4F01]'
                      }`}
                    >
                      {name}
                      <button
                        type="button"
                        onClick={() => toggleSymbol(Number(id), name)}
                        disabled={!canRemove}
                        aria-label={`Remove pair ${name}`}
                        className={`w-5 h-5 rounded-md flex items-center justify-center active:scale-95 ${
                          pendingOnly ? 'text-amber-300/70' : 'text-[#FF4F01]/70'
                        } ${canRemove ? '' : 'opacity-30 cursor-not-allowed'}`}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  );
                })}
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
                : displayPairIds.length > 0
                  ? `Edit pairs (${displayPairIds.length} selected)`
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
                    const checked = displayPairIds.includes(Number(s.symbolId));
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
            <CountdownLine
              requestedAt={locks.pairWhitelist.unlockRequestedAt}
              label="Allowed pairs unlocks in"
              onCancel={() => persist({ ...locks, pairWhitelist: cancelUnlockRequest(locks.pairWhitelist) })}
            />
            {pendingPair && (
              <CountdownLine
                requestedAt={pendingPair.requestedAt}
                label="Allowed pairs change takes effect in"
                onCancel={() => persist({ ...locks, pairWhitelist: cancelPendingChange(locks.pairWhitelist) })}
              />
            )}
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
                : 'Unlimited'} · {blocksToday > 0 ? `${blocksToday} blocked today` : 'closes never blocked'}
            </p>
          </div>
          <Toggle on={mtActive} cooling={mtCooling} onFlip={() => flip('maxTrades')} label="Toggle max trades per day lock" />
        </div>
        {(locks.maxTrades.enabled || maxEditOpen) && (
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
                    openMaxTradesEditor();
                  }}
                  className="text-[11px] font-black text-[#FF4F01] active:scale-95"
                >
                  Edit
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <label htmlFor="locks-max-trades" className="text-[11px] font-bold text-zinc-500">
                    Limit
                  </label>
                  <input
                    id="locks-max-trades"
                    inputMode="numeric"
                    value={maxTradesRaw}
                    onChange={(e) => setMaxTradesRaw(e.target.value.replace(/\D/g, ''))}
                    className="w-20 h-10 rounded-lg border bg-[#000000] border-[#27272a] px-2.5 text-[13px] font-bold tabular-nums text-white outline-none focus:border-[#FF4F01]"
                  />
                  <button
                    type="button"
                    onClick={commitMaxTrades}
                    disabled={!!maxTradesError}
                    className="h-10 px-4 rounded-lg bg-[#FF4F01]/15 text-[#FF4F01] text-[12px] font-bold active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Done
                  </button>
                </div>
                {maxTradesError && <p className="mt-1.5 text-[11px] font-bold text-rose-400">{maxTradesError}</p>}
              </>
            )}
            <CountdownLine
              requestedAt={locks.maxTrades.unlockRequestedAt}
              label="Max trades unlocks in"
              onCancel={() => persist({ ...locks, maxTrades: cancelUnlockRequest(locks.maxTrades) })}
            />
            {locks.maxTrades.pendingChange && (
              <CountdownLine
                requestedAt={locks.maxTrades.pendingChange.requestedAt}
                label={`Max ${locks.maxTrades.pendingChange.value.maxPerDay ?? '?'}/day takes effect in`}
                onCancel={() => persist({ ...locks, maxTrades: cancelPendingChange(locks.maxTrades) })}
              />
            )}
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
          <Toggle
            on={lgActive}
            cooling={lgCooling}
            onFlip={() => flip('lotGuard')}
            label="Toggle lot size lock"
          />
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
                    openLotEditor();
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
                      onChange={(e) => setMinRaw(cleanDecimal(e.target.value))}
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
                      onChange={(e) => setMaxRaw(cleanDecimal(e.target.value))}
                      className="w-full h-10 rounded-lg border bg-[#000000] border-[#27272a] px-2.5 text-[13px] tabular-nums text-white placeholder:text-zinc-600 outline-none focus:border-[#FF4F01]"
                    />
                  </div>
                </div>
                {lotError && <p className="mt-1.5 text-[11px] font-bold text-rose-400">{lotError}</p>}
                <button
                  type="button"
                  onClick={commitLots}
                  disabled={!!lotError}
                  className="mt-2 w-full h-10 rounded-lg bg-[#FF4F01]/15 text-[#FF4F01] text-[12px] font-bold active:scale-[0.99] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Done
                </button>
              </>
            )}
            <CountdownLine
              requestedAt={locks.lotGuard.unlockRequestedAt}
              label="Lot limits unlock in"
              onCancel={() => persist({ ...locks, lotGuard: cancelUnlockRequest(locks.lotGuard) })}
            />
            {locks.lotGuard.pendingChange && (
              <CountdownLine
                requestedAt={locks.lotGuard.pendingChange.requestedAt}
                label="Lot limits change takes effect in"
                onCancel={() => persist({ ...locks, lotGuard: cancelPendingChange(locks.lotGuard) })}
              />
            )}
          </div>
        )}
      </div>

      {selectedPortfolio && (
        <p className="text-[10px] text-zinc-600 px-1 mt-2 leading-relaxed">
          Locks apply to {selectedPortfolio.name}. {anyActive ? (
            <span className="inline-flex items-center gap-1 text-amber-300 font-bold"><Lock size={10} /> Enforced on new orders.</span>
          ) : (
            'No active locks.'
          )}
        </p>
      )}

      <ConfirmationModal
        isOpen={!!confirm}
        title={confirm ? (confirm.kind === 'off' ? `Turn off ${RULE_NAMES[confirm.key]}?` : `Keep ${RULE_NAMES[confirm.key]} on?`) : ''}
        description={
          confirm
            ? confirm.kind === 'off'
              ? 'It stays enforced for 24 hours, then switches off. You can cancel anytime before then.'
              : 'This cancels the 24h countdown and keeps the lock enforced.'
            : ''
        }
        confirmText={confirm?.kind === 'off' ? 'Start 24h countdown' : 'Keep on'}
        cancelText="Cancel"
        variant="warning"
        onConfirm={applyConfirm}
        onCancel={() => setConfirm(null)}
        isDarkMode={true}
      />
    </div>
  );
};
