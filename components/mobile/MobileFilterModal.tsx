import React, { useState } from 'react';
import { X, Check } from 'lucide-react';
import { haptic } from '../../lib/haptics';

export interface MobileFilterState {
  dateRange: 'all' | 'today' | 'week' | 'month' | '30days';
  outcome: 'all' | 'win' | 'loss';
  direction: 'all' | 'long' | 'short';
  selectedPair?: string;
}

interface MobileFilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  filters: MobileFilterState;
  onApplyFilters: (filters: MobileFilterState) => void;
  availablePairs?: string[];
}

export const MobileFilterModal: React.FC<MobileFilterModalProps> = ({
  isOpen,
  onClose,
  filters,
  onApplyFilters,
  availablePairs = [],
}) => {
  const [localFilters, setLocalFilters] = useState<MobileFilterState>(filters);

  if (!isOpen) return null;

  const handleApply = () => {
    try { haptic.selection(); } catch {}
    onApplyFilters(localFilters);
    onClose();
  };

  const handleReset = () => {
    try { haptic.light(); } catch {}
    const reset: MobileFilterState = {
      dateRange: 'all',
      outcome: 'all',
      direction: 'all',
    };
    setLocalFilters(reset);
    onApplyFilters(reset);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[220] flex items-end justify-center animate-in fade-in duration-200">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/75 backdrop-blur-sm"
        onClick={() => {
          try { haptic.light(); } catch {}
          onClose();
        }}
      />

      {/* Sheet */}
      <div className="relative w-full max-w-lg bg-[#000000] border-t border-[#27272a] rounded-t-3xl p-5 z-10 shadow-2xl safe-area-inset-bottom animate-in slide-in-from-bottom duration-250">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[#27272a] mb-4">
          <h3 className="text-base font-black text-white">Filter Trades</h3>
          <button
            onClick={() => {
              try { haptic.light(); } catch {}
              onClose();
            }}
            className="w-7 h-7 rounded-lg bg-[#000000] text-zinc-400 hover:text-white flex items-center justify-center border border-[#27272a]"
          >
            <X size={15} />
          </button>
        </div>

        {/* Filters Content */}
        <div className="space-y-4">
          
          {/* 1. Date Range */}
          <div>
            <p className="text-xs font-bold text-zinc-400 mb-2 uppercase tracking-wider">Date Range</p>
            <div className="flex flex-wrap gap-1.5">
              {[
                { id: 'all' as const, label: 'All Time' },
                { id: 'today' as const, label: 'Today' },
                { id: 'week' as const, label: 'This Week' },
                { id: 'month' as const, label: 'This Month' },
                { id: '30days' as const, label: '30 Days' },
              ].map((opt) => {
                const isSelected = localFilters.dateRange === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => {
                      try { haptic.selection(); } catch {}
                      setLocalFilters((prev) => ({ ...prev, dateRange: opt.id }));
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                      isSelected
                        ? 'bg-[#3B5BFD] text-white shadow-[0_2px_8px_rgba(59,91,253,0.3)]'
                        : 'bg-[#000000] border border-[#27272a] text-zinc-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Outcome */}
          <div>
            <p className="text-xs font-bold text-zinc-400 mb-2 uppercase tracking-wider">Outcome</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'all' as const, label: 'All' },
                { id: 'win' as const, label: 'Wins Only' },
                { id: 'loss' as const, label: 'Losses Only' },
              ].map((opt) => {
                const isSelected = localFilters.outcome === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => {
                      try { haptic.selection(); } catch {}
                      setLocalFilters((prev) => ({ ...prev, outcome: opt.id }));
                    }}
                    className={`py-2 rounded-xl text-xs font-bold text-center transition-all ${
                      isSelected
                        ? 'bg-[#3B5BFD] text-white shadow-[0_2px_8px_rgba(59,91,253,0.3)]'
                        : 'bg-[#000000] border border-[#27272a] text-zinc-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. Direction */}
          <div>
            <p className="text-xs font-bold text-zinc-400 mb-2 uppercase tracking-wider">Direction</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'all' as const, label: 'All' },
                { id: 'long' as const, label: 'Longs' },
                { id: 'short' as const, label: 'Shorts' },
              ].map((opt) => {
                const isSelected = localFilters.direction === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => {
                      try { haptic.selection(); } catch {}
                      setLocalFilters((prev) => ({ ...prev, direction: opt.id }));
                    }}
                    className={`py-2 rounded-xl text-xs font-bold text-center transition-all ${
                      isSelected
                        ? 'bg-[#3B5BFD] text-white shadow-[0_2px_8px_rgba(59,91,253,0.3)]'
                        : 'bg-[#000000] border border-[#27272a] text-zinc-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

        </div>

        {/* Footer Actions */}
        <div className="grid grid-cols-2 gap-3 mt-6 pt-4 border-t border-[#27272a]">
          <button
            onClick={handleReset}
            className="py-2.5 rounded-xl bg-[#000000] border border-[#27272a] text-zinc-300 font-bold text-xs active:scale-95"
          >
            Reset
          </button>
          <button
            onClick={handleApply}
            className="py-2.5 rounded-xl bg-[#3B5BFD] text-white font-bold text-xs shadow-[0_2px_12px_rgba(59,91,253,0.35)] active:scale-95 flex items-center justify-center gap-1.5"
          >
            <Check size={14} /> Apply Filters
          </button>
        </div>

      </div>
    </div>
  );
};
