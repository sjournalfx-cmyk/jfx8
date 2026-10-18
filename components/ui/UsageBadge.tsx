import React from 'react';
import { cn } from '../../lib/utils';

interface UsageBadgeProps {
  /** Trades already logged in the current month. */
  used?: number;
  /** Finiteness check happens here — `Infinity`/undefined hides the badge. */
  limit?: number;
  isDarkMode?: boolean;
  className?: string;
}

/**
 * Small "x of y trades this month" pill shown near the Log Trade entry.
 * Renders nothing when the plan has no finite monthly limit (or the numbers
 * are unknown), and turns amber once the user has used 80% or more.
 */
export const UsageBadge: React.FC<UsageBadgeProps> = ({ used, limit, isDarkMode = true, className }) => {
  if (typeof used !== 'number' || used < 0) return null;
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return null;

  const atRisk = used >= limit * 0.8;
  const tone = atRisk
    ? isDarkMode
      ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
      : 'border-amber-500/40 bg-amber-50 text-amber-700'
    : isDarkMode
      ? 'border-zinc-700/60 bg-zinc-800/40 text-zinc-400'
      : 'border-slate-200 bg-slate-50 text-slate-500';

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-mono font-semibold leading-none whitespace-nowrap',
        tone,
        className
      )}
      title={`${used} of ${limit} trades used this month`}
    >
      {used} of {limit} trades this month
    </span>
  );
};

export default UsageBadge;
