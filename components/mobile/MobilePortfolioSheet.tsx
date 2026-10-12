import React from 'react';
import { Check, Layers, ChevronRight } from 'lucide-react';
import { Portfolio, MAX_PORTFOLIOS } from '../../types';
import { haptic } from '../../lib/haptics';

interface MobilePortfolioSheetProps {
  isOpen: boolean;
  onClose: () => void;
  portfolios: Portfolio[];
  activePortfolioId: string | null;
  defaultPortfolioId: string | null;
  tradeCounts?: Record<string, number>;
  balances?: Record<string, number>;
  currencySymbol?: string;
  onSelect: (id: string) => void;
  onManagePortfolios: () => void;
}

const SOURCE_LABEL: Record<string, string> = {
  manual: 'Manual',
  ctrader: 'cTrader',
  bridge: 'Bridge',
};

/**
 * Bottom sheet portfolio switcher (mobile). Pops from the bottom when the
 * header portfolio name is tapped; shows every portfolio + live balance.
 */
export const MobilePortfolioSheet: React.FC<MobilePortfolioSheetProps> = ({
  isOpen,
  onClose,
  portfolios,
  activePortfolioId,
  defaultPortfolioId,
  tradeCounts,
  balances,
  currencySymbol = '$',
  onSelect,
  onManagePortfolios,
}) => {
  if (!isOpen) return null;

  const fmt = (val: number) => {
    const abs = Math.abs(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${val < 0 ? '-' : ''}${currencySymbol}${abs}`;
  };

  return (
    <div className="fixed inset-0 z-[200]">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-sheet-fade"
        onClick={() => {
          try { haptic.light(); } catch {}
          onClose();
        }}
      />
      <div className="absolute bottom-0 left-0 right-0 bg-[#000000] rounded-t-[24px] px-4 pt-2 pb-[calc(1.25rem+env(safe-area-inset-bottom))] max-h-[75dvh] flex flex-col animate-sheet-up">
        <div className="mx-auto my-2 h-1 w-10 rounded-full bg-white/15 shrink-0" />
        <div className="flex items-center justify-between px-1 pb-2 shrink-0">
          <p className="text-[15px] font-black tracking-tight text-white">
            Portfolios <span className="ml-1 text-[11px] font-bold text-zinc-500">{portfolios.length} of {MAX_PORTFOLIOS}</span>
          </p>
          <button
            onClick={() => {
              try { haptic.selection(); } catch {}
              onManagePortfolios();
            }}
            className="flex items-center gap-0.5 text-[13px] font-bold text-[#FF4F01] active:scale-95 transition-all"
          >
            Manage <ChevronRight size={15} strokeWidth={2.5} />
          </button>
        </div>
        <div className="overflow-y-auto no-scrollbar -mx-1 px-1 py-1 space-y-1.5">
          {portfolios.map(p => {
            const isActive = p.id === activePortfolioId;
            const isDefault = p.id === defaultPortfolioId || p.isDefault;
            const count = tradeCounts?.[p.id] ?? 0;
            const balance = balances?.[p.id];
            return (
              <button
                key={p.id}
                onClick={() => {
                  try { haptic.selection(); } catch {}
                  if (!isActive) onSelect(p.id);
                  onClose();
                }}
                className={`w-full p-3 rounded-2xl flex items-center gap-3 text-left transition-all active:scale-[0.99] ${
                  isActive ? 'bg-[#FF4F01]/[0.1]' : 'bg-white/[0.03] active:bg-white/[0.06]'
                }`}
              >
                <Layers size={17} className={`shrink-0 ${isActive ? 'text-[#FF4F01]' : 'text-zinc-500'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-bold text-white truncate">
                    {p.name}
                    {isDefault && (
                      <span className="ml-1.5 text-[9px] font-black uppercase tracking-widest text-zinc-500">Default</span>
                    )}
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-0.5">
                    {SOURCE_LABEL[p.source] || 'Manual'} · {count} trade{count === 1 ? '' : 's'}
                  </p>
                </div>
                {typeof balance === 'number' && (
                  <p className={`text-[13px] font-bold jfx-value-mono shrink-0 ${balance < 0 ? 'text-rose-400' : 'text-white'}`}>

                    {fmt(balance)}
                  </p>
                )}
                {isActive && <Check size={17} className="text-[#FF4F01] shrink-0" strokeWidth={2.5} />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
