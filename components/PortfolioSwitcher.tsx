import React, { useState, useEffect } from 'react';
import { Layers, CheckCircle2, Plus, Trash2, X, Pencil, Link2, Radio, Wallet } from 'lucide-react';
import { Portfolio, PortfolioSource, PortfolioPurpose, MAX_PORTFOLIOS } from '../types';
import { haptic } from '../lib/haptics';
import { DESKTOP_BRIDGE_ENABLED } from '../config/features';

const SOURCES: { id: PortfolioSource; label: string; hint: string; icon: React.ElementType }[] = [
  { id: 'manual', label: 'Manual + Imports', hint: 'Hand-log & CSV files', icon: Pencil },
  { id: 'ctrader', label: 'cTrader', hint: 'Auto-sync account', icon: Link2 },
  { id: 'bridge', label: 'Desktop Bridge', hint: 'MT4/MT5 via EA', icon: Radio },
];

const sourceOf = (p: Portfolio) => SOURCES.find(s => s.id === p.source) || SOURCES[0];

interface PortfolioSwitcherProps {
  portfolios: Portfolio[];
  activeId: string | null;
  defaultId: string | null;
  canAdd: boolean;
  isDarkMode?: boolean;
  variant?: 'drawer' | 'settings';
  tradeCounts?: Record<string, number>;
  onSelect: (id: string) => void;
  onAdd: (input: {
    name: string;
    description?: string;
    purpose?: PortfolioPurpose;
    source?: PortfolioSource;
    startingBalance?: number;
    currency?: string;
  }) => Promise<Portfolio>;
  onRemove: (id: string) => Promise<void>;
  /** Increment to auto-expand the create form (e.g. from the drawer shortcut). */
  startCreatingSignal?: number;
}

export const PortfolioSwitcher: React.FC<PortfolioSwitcherProps> = ({
  portfolios,
  activeId,
  defaultId,
  canAdd,
  isDarkMode,
  variant = 'drawer',
  tradeCounts,
  onSelect,
  onAdd,
  onRemove,
  startCreatingSignal = 0,
}) => {
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [source, setSource] = useState<PortfolioSource>('manual');
  const [startingBalance, setStartingBalance] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const dark = variant === 'drawer' ? true : !!isDarkMode;

  useEffect(() => {
    if (startCreatingSignal > 0 && canAdd) {
      setError(null);
      setShowAdd(true);
    }
  }, [startCreatingSignal, canAdd]);

  const resetForm = () => {
    setName('');
    setSource('manual');
    setStartingBalance('');
    setError(null);
    setShowAdd(false);
  };

  const handleAdd = async () => {
    setError(null);
    setSaving(true);
    try {
      await onAdd({
        name,
        source,
        startingBalance: source === 'manual' && startingBalance ? Number(startingBalance) : undefined,
      });
      try { haptic.success(); } catch { /* noop */ }
      resetForm();
    } catch (e: any) {
      setError(e?.message || 'Could not create portfolio.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      window.setTimeout(() => setConfirmDeleteId(cur => (cur === id ? null : cur)), 3500);
      return;
    }
    setConfirmDeleteId(null);
    setError(null);
    try {
      await onRemove(id);
      try { haptic.success(); } catch { /* noop */ }
    } catch (e: any) {
      setError(e?.message || 'Could not delete portfolio.');
    }
  };

  const inputClass = dark
    ? 'w-full px-3 py-2 rounded-xl text-sm bg-white/[0.06] border border-white/10 text-white placeholder:text-zinc-500 outline-none focus:border-[#FF4F01]/60'
    : 'w-full px-3 py-2 rounded-xl text-sm bg-white border border-slate-200 text-slate-900 placeholder:text-slate-400 outline-none focus:border-[#FF4F01]/60';
  const labelClass = `block text-[11px] font-bold uppercase tracking-wider mb-1 ${dark ? 'text-zinc-400' : 'text-slate-500'}`;

  return (
    <div>
      {variant === 'drawer' && (
        <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-2">
          Portfolios <span className="opacity-60">· {portfolios.length}/{MAX_PORTFOLIOS}</span>
        </p>
      )}
      <div className="space-y-1.5">
        {portfolios.length > 1 && (
          <div
            className={`w-full rounded-xl border flex items-center justify-between text-left transition-all ${
              variant === 'drawer'
                ? activeId === 'all'
                  ? 'bg-[#000000] border-[#FF4F01] text-white shadow-[0_2px_8px_rgba(255,79,1,0.2)]'
                  : 'bg-[#000000] border-[#27272a] text-zinc-300'
                : activeId === 'all'
                  ? 'bg-[#FF4F01]/[0.07] border-[#FF4F01]/60'
                  : dark ? 'bg-black/20 border-white/[0.08]' : 'bg-white border-slate-200'
            }`}
          >
            <button
              onClick={() => {
                try { haptic.selection(); } catch { /* noop */ }
                onSelect('all');
              }}
              className="flex-1 min-w-0 p-2.5 flex items-center gap-2.5 text-left"
            >
              <Layers size={16} className={`shrink-0 ${activeId === 'all' ? 'text-[#FF4F01]' : 'text-zinc-500'}`} />
              <div className="min-w-0 flex-1">
                <p className={`text-xs font-bold truncate ${variant === 'drawer' ? '' : dark ? 'text-white' : 'text-slate-900'}`}>
                  All Portfolios
                </p>
                <p className="text-[10px] text-zinc-400 truncate">
                  Combined view across all portfolios
                  {typeof tradeCounts?.['all'] === 'number' ? ` · ${tradeCounts['all']} trades` : ''}
                </p>
              </div>
              {activeId === 'all' && <CheckCircle2 size={16} className="text-[#FF4F01] shrink-0" />}
            </button>
          </div>
        )}
        {portfolios.map(p => {
          const isSelected = activeId === p.id;
          const isDefault = p.id === defaultId || p.isDefault;
          const SourceIcon = sourceOf(p).icon;
          const count = tradeCounts?.[p.id];
          const needsLink = (p.source || 'manual') !== 'manual' && !(p.accounts && p.accounts.length);
          return (
            <div
              key={p.id}
              className={`w-full rounded-xl border flex items-center justify-between text-left transition-all ${
                variant === 'drawer'
                  ? isSelected
                    ? 'bg-[#000000] border-[#FF4F01] text-white shadow-[0_2px_8px_rgba(255,79,1,0.2)]'
                    : 'bg-[#000000] border-[#27272a] text-zinc-300'
                  : isSelected
                    ? 'bg-[#FF4F01]/[0.07] border-[#FF4F01]/60'
                    : dark ? 'bg-black/20 border-white/[0.08]' : 'bg-white border-slate-200'
              }`}
            >
              <button
                onClick={() => {
                  try { haptic.selection(); } catch { /* noop */ }
                  onSelect(p.id);
                }}
                className="flex-1 min-w-0 p-2.5 flex items-center gap-2.5 text-left"
              >
                <Layers size={16} className={`shrink-0 ${isSelected ? 'text-[#FF4F01]' : 'text-zinc-500'}`} />
                <div className="min-w-0 flex-1">
                  <p className={`text-xs font-bold truncate ${variant === 'drawer' ? '' : dark ? 'text-white' : 'text-slate-900'}`}>
                    {p.name}
                    {isDefault && <span className={`ml-1.5 text-[9px] font-black uppercase tracking-widest ${isSelected ? 'text-[#FF4F01]' : 'opacity-50'}`}>Default</span>}
                  </p>
                  <p className="text-[10px] text-zinc-400 truncate">
                    {needsLink ? 'Not linked — tap to connect' : ((p.source || 'manual') !== 'manual' ? 'Tap to open connection' : (p.description || 'Trading Journal'))}
                    {typeof count === 'number' ? ` · ${count} trade${count === 1 ? '' : 's'}` : ''}
                  </p>
                </div>
                <span title={sourceOf(p).label} className="shrink-0 opacity-50">
                  <SourceIcon size={13} />
                </span>
                {isSelected && <CheckCircle2 size={16} className="text-[#FF4F01] shrink-0" />}
              </button>
              {!isDefault && (
                <button
                  onClick={() => void handleDelete(p.id)}
                  title={confirmDeleteId === p.id ? 'Tap again to confirm delete (trades move to Default)' : 'Delete portfolio'}
                  aria-label="Delete portfolio"
                  className={`mr-2 p-1.5 rounded-lg shrink-0 transition-colors ${
                    confirmDeleteId === p.id
                      ? 'bg-rose-500 text-white text-[10px] font-black px-2'
                      : 'text-zinc-600 hover:text-rose-500 hover:bg-rose-500/10'
                  }`}
                >
                  {confirmDeleteId === p.id ? 'Sure?' : <Trash2 size={13} />}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="mt-2 text-[11px] font-bold text-rose-500">{error}</p>}

      {!showAdd ? (
        <button
          onClick={() => {
            if (!canAdd) {
              setError(`Portfolio slots full (${MAX_PORTFOLIOS}/${MAX_PORTFOLIOS}). Delete one to make room.`);
              return;
            }
            setError(null);
            setShowAdd(true);
          }}
          className={`mt-2 w-full p-2.5 rounded-xl border border-dashed flex items-center justify-center gap-2 text-xs font-bold transition-all ${
            dark
              ? 'border-white/15 text-zinc-400 hover:text-white hover:border-[#FF4F01]/50'
              : 'border-slate-300 text-slate-500 hover:text-slate-900 hover:border-[#FF4F01]/50'
          }`}
        >
          <Plus size={14} /> New portfolio
        </button>
      ) : (
        <div className={`mt-2 p-3 rounded-xl border space-y-2.5 ${dark ? 'border-white/10 bg-white/[0.03]' : 'border-slate-200 bg-slate-50'}`}>
          <div className="flex items-center justify-between">
            <p className={`text-xs font-black uppercase tracking-widest ${dark ? 'text-white' : 'text-slate-900'}`}>New portfolio</p>
            <button onClick={resetForm} aria-label="Cancel" className="opacity-50 hover:opacity-100"><X size={14} /></button>
          </div>
          <div>
            <label className={labelClass}>Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Funded 100K"
              maxLength={80}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Connection</label>
            <div className="space-y-1.5">
              {SOURCES.map(s => {
                const isBridgeDisabled = s.id === 'bridge' && !DESKTOP_BRIDGE_ENABLED;
                return (
                  <button
                    key={s.id}
                    onClick={() => {
                      if (isBridgeDisabled) return;
                      setSource(s.id);
                      if (s.id !== 'manual') setStartingBalance('');
                    }}
                    disabled={isBridgeDisabled}
                    aria-disabled={isBridgeDisabled}
                    className={`w-full p-2 rounded-xl border flex items-center gap-2.5 text-left transition-all ${
                      isBridgeDisabled
                        ? `opacity-50 cursor-not-allowed ${dark ? 'border-white/10' : 'border-slate-200'}`
                        : source === s.id
                          ? 'border-[#FF4F01]/70 bg-[#FF4F01]/[0.08]'
                          : dark ? 'border-white/10 hover:border-white/25' : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <s.icon size={15} className={source === s.id && !isBridgeDisabled ? 'text-[#FF4F01]' : 'opacity-50'} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-bold ${dark ? 'text-white' : 'text-slate-900'}`}>{s.label}</p>
                      <p className="text-[10px] opacity-60">{s.hint}</p>
                    </div>
                    {source === s.id && !isBridgeDisabled && <CheckCircle2 size={14} className="text-[#FF4F01] shrink-0" />}
                  </button>
                );
              })}
            </div>
            {source !== 'manual' && (
              <p className="mt-1.5 text-[10px] opacity-60 leading-snug">
                After creating, you'll pick a broker or connect your cTrader account. One account per portfolio.
              </p>
            )}
          </div>
          {source === 'manual' && (
            <div>
              <label className={labelClass}>Starting balance (optional)</label>
              <div className="relative">
                <Wallet size={13} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40" />
                <input
                  value={startingBalance}
                  onChange={e => setStartingBalance(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="100000"
                  inputMode="decimal"
                  className={`${inputClass} pl-8 font-mono`}
                />
              </div>
            </div>
          )}
          <button
            onClick={() => void handleAdd()}
            disabled={saving || !name.trim()}
            className="w-full py-2.5 rounded-xl bg-[#FF4F01] text-white text-xs font-black uppercase tracking-widest disabled:opacity-40 shadow-[0_2px_12px_rgba(255,79,1,0.35)]"
          >
            {saving ? 'Creating…' : 'Create portfolio'}
          </button>
        </div>
      )}
    </div>
  );
};
