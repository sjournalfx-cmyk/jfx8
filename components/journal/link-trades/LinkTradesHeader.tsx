import React from 'react';
import { X, Link2 } from 'lucide-react';
import { cn } from '../../../lib/utils';

interface LinkTradesHeaderProps {
  count: number;
  isDarkMode: boolean;
  onClose: () => void;
}

export const LinkTradesHeader: React.FC<LinkTradesHeaderProps> = ({ count, isDarkMode, onClose }) => {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div
          aria-hidden
          className={cn(
            'shrink-0 grid place-items-center size-9 rounded-xl border',
            isDarkMode
              ? 'bg-zinc-900 border-zinc-800 text-zinc-200'
              : 'bg-slate-100 border-slate-200 text-slate-700'
          )}
        >
          <Link2 size={16} strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <h3
            className={cn(
              'text-[15px] font-semibold leading-tight tracking-tight truncate',
              isDarkMode ? 'text-zinc-100' : 'text-slate-900'
            )}
          >
            Link trades
          </h3>
          <p className={cn('text-xs mt-0.5', isDarkMode ? 'text-zinc-500' : 'text-slate-500')}>
            {count} selected
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close link trades"
        className={cn(
          'shrink-0 grid place-items-center size-8 rounded-full transition-colors',
          isDarkMode
            ? 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200'
            : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
        )}
      >
        <X size={16} />
      </button>
    </div>
  );
};
