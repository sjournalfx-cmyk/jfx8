import React from 'react';
import { Info, TriangleAlert } from 'lucide-react';
import { cn } from '../../../lib/utils';

interface LinkTradesNoticeProps {
  kind: 'warn' | 'info';
  isDarkMode: boolean;
  children: React.ReactNode;
}

export const LinkTradesNotice: React.FC<LinkTradesNoticeProps> = ({ kind, isDarkMode, children }) => {
  const Icon = kind === 'warn' ? TriangleAlert : Info;
  return (
    <div
      role={kind === 'warn' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[13px] leading-relaxed',
        kind === 'warn'
          ? isDarkMode
            ? 'border-amber-500/25 bg-amber-500/[0.07] text-amber-200/90'
            : 'border-amber-300 bg-amber-50 text-amber-800'
          : isDarkMode
            ? 'border-zinc-800 bg-zinc-900/60 text-zinc-400'
            : 'border-slate-200 bg-slate-50 text-slate-600'
      )}
    >
      <Icon size={15} className="mt-0.5 shrink-0 opacity-70" />
      <span className="min-w-0">{children}</span>
    </div>
  );
};
