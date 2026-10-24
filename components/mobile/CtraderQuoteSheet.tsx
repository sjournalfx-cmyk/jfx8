import React from 'react';
import { X } from 'lucide-react';
import { haptic } from '../../lib/haptics';

interface CtraderQuoteSheetProps {
  symbolName: string;
  onNewOrder: () => void;
  onChart: () => void;
  onClose: () => void;
  /**
   * `sheet` (default) is the mobile bottom drawer. Desktop uses `panel` for the
   * inline side panel or `modal` for the centered overlay.
   */
  variant?: 'sheet' | 'panel' | 'modal';
}

/**
 * MT5-style quote tap drawer: plain text rows — "New Order" and "Chart".
 * Mobile keeps the bottom-sheet presentation; desktop renders the same
 * actions as a side panel or modal.
 */
export const CtraderQuoteSheet: React.FC<CtraderQuoteSheetProps> = ({
  symbolName,
  onNewOrder,
  onChart,
  onClose,
  variant = 'sheet',
}) => {
  const press = (fn: () => void) => () => {
    try {
      haptic.selection();
    } catch {}
    fn();
  };

  const actionClass = variant === 'sheet'
    ? 'w-full text-left px-5 py-4 text-[17px] font-medium text-zinc-100 active:bg-white/10 transition-colors touch-manipulation'
    : 'w-full text-left px-5 py-4 text-[17px] font-medium text-zinc-100 hover:bg-white/10 active:bg-white/10 transition-colors touch-manipulation rounded-lg';

  const actions = (
    <div className={variant === 'panel' ? 'mt-1' : ''}>
      <button type="button" onClick={press(onNewOrder)} className={actionClass}>
        New Order
      </button>
      <button type="button" onClick={press(onChart)} className={actionClass}>
        Chart
      </button>
    </div>
  );

  if (variant === 'panel') {
    return (
      <div className="rounded-xl border border-white/10 bg-[#1c1c1e] overflow-hidden">
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <p className="text-[15px] font-bold text-zinc-300">{symbolName}</p>
          <button
            type="button"
            onClick={press(onClose)}
            aria-label="Close quote actions"
            className="w-8 h-8 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5 flex items-center justify-center transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        {actions}
      </div>
    );
  }

  if (variant === 'modal') {
    return (
      <div className="fixed inset-0 z-[230] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={press(onClose)} aria-label="Dismiss" />
        <div className="relative z-10 w-full max-w-sm rounded-2xl border border-white/10 bg-[#2b2b2b] overflow-hidden shadow-2xl">
          <div className="flex items-center justify-between px-4 pt-3 pb-1">
            <p className="text-[15px] font-bold text-zinc-300">{symbolName}</p>
            <button
              type="button"
              onClick={press(onClose)}
              aria-label="Close quote actions"
              className="w-8 h-8 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5 flex items-center justify-center transition-colors"
            >
              <X size={16} />
            </button>
          </div>
          {actions}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[230]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-sheet-fade"
        onClick={press(onClose)}
        aria-label="Dismiss"
      />

      {/* Sheet */}
      <div className="absolute bottom-0 left-0 right-0 bg-[#2b2b2b] rounded-t-[20px] pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))] overflow-hidden animate-sheet-up">
        <div className="mx-auto my-1 h-1 w-10 rounded-full bg-white/15 shrink-0" />
        <div className="px-5 pt-2 pb-1">
          <p className="text-[15px] font-bold text-zinc-400">{symbolName}</p>
        </div>
        {actions}
      </div>
    </div>
  );
};
