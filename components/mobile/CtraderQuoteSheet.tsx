import React from 'react';
import { haptic } from '../../lib/haptics';

interface CtraderQuoteSheetProps {
  symbolName: string;
  onNewOrder: () => void;
  onChart: () => void;
  onClose: () => void;
}

/**
 * MT5-style quote tap drawer: slides up from the bottom with plain text
 * rows — "New Order" and "Chart". Backdrop tap dismisses.
 *
 * Layout intentionally copies MobilePortfolioSheet (absolute bottom sheet,
 * NOT a flex-row item) — the flex-row variant collapses to a narrow strip
 * inside the quotes tab stacking context.
 */
export const CtraderQuoteSheet: React.FC<CtraderQuoteSheetProps> = ({
  symbolName,
  onNewOrder,
  onChart,
  onClose,
}) => {
  const press = (fn: () => void) => () => {
    try {
      haptic.selection();
    } catch {}
    fn();
  };

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
        <button
          type="button"
          onClick={press(onNewOrder)}
          className="w-full text-left px-5 py-4 text-[17px] font-medium text-zinc-100 active:bg-white/10 transition-colors touch-manipulation"
        >
          New Order
        </button>
        <button
          type="button"
          onClick={press(onChart)}
          className="w-full text-left px-5 py-4 text-[17px] font-medium text-zinc-100 active:bg-white/10 transition-colors touch-manipulation"
        >
          Chart
        </button>
      </div>
    </div>
  );
};
