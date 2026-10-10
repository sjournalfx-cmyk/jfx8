import React from 'react';
import { cn } from '../../../lib/utils';

interface LinkTradesSummaryProps {
  count: number;
  pairCount?: number;
  isDarkMode: boolean;
}

export const LinkTradesSummary: React.FC<LinkTradesSummaryProps> = ({ count, pairCount, isDarkMode }) => {
  return (
    <p className={cn('text-[13px] leading-relaxed', isDarkMode ? 'text-zinc-400' : 'text-slate-600')}>
      Link {count} trades as one setup.
      {typeof pairCount === 'number' && pairCount > 0 && (
        <span className={cn('ml-1', isDarkMode ? 'text-zinc-500' : 'text-slate-500')}>
          {pairCount} pair{pairCount === 1 ? '' : 's'}
        </span>
      )}
    </p>
  );
};
