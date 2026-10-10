import React from 'react';
import { cn } from '../../../lib/utils';

interface LinkTradesActionsProps {
  count: number;
  disabled: boolean;
  isDarkMode: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const LinkTradesActions: React.FC<LinkTradesActionsProps> = ({
  count,
  disabled,
  isDarkMode,
  onCancel,
  onConfirm,
}) => {
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <button
        type="button"
        onClick={onCancel}
        className={cn(
          'w-full sm:w-auto px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors min-h-[44px] sm:min-h-0',
          isDarkMode
            ? 'text-zinc-300 hover:bg-zinc-900'
            : 'text-slate-600 hover:bg-slate-100'
        )}
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={disabled}
        className={cn(
          'w-full sm:w-auto px-4 py-2.5 rounded-xl text-sm font-semibold transition-all min-h-[44px] sm:min-h-0',
          'disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]',
          isDarkMode
            ? 'bg-zinc-100 text-zinc-900 hover:bg-white disabled:hover:bg-zinc-100'
            : 'bg-slate-900 text-white hover:bg-slate-800 disabled:hover:bg-slate-900'
        )}
      >
        Link {count > 0 ? `${count} trades` : 'trades'}
      </button>
    </div>
  );
};
