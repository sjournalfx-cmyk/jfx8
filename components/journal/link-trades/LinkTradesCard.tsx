import React, { useEffect } from 'react';
import { cn } from '../../../lib/utils';
import { LinkTradesHeader } from './LinkTradesHeader';
import { LinkTradesSummary } from './LinkTradesSummary';
import { LinkTradesSetupInput } from './LinkTradesSetupInput';
import { LinkTradesNotice } from './LinkTradesNotice';
import { LinkTradesActions } from './LinkTradesActions';

export interface LinkTradesCardProps {
  count: number;
  setupName: string;
  onSetupNameChange: (value: string) => void;
  placeholderName?: string;
  pairCount?: number;
  mixedState?: boolean;
  alreadyLinked?: boolean;
  isDarkMode: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export const LinkTradesCard: React.FC<LinkTradesCardProps> = ({
  count,
  setupName,
  onSetupNameChange,
  placeholderName,
  pairCount,
  mixedState,
  alreadyLinked,
  isDarkMode,
  onClose,
  onConfirm,
}) => {
  const canConfirm = setupName.trim().length > 0 && count >= 2;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[300] flex items-end justify-center sm:items-center sm:p-6">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Link trades"
        className={cn(
          'relative w-full sm:max-w-[400px] border shadow-2xl',
          // Bottom sheet on phones, centered card on desktop — fixes the squeezed modal in the screenshot
          'rounded-t-2xl border-b-0 sm:rounded-2xl sm:border-b',
          'max-h-[92dvh] overflow-y-auto',
          'p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]',
          isDarkMode
            ? 'bg-zinc-950 border-zinc-800 text-zinc-100'
            : 'bg-white border-slate-200 text-slate-900'
        )}
      >
        {/* Grab handle for bottom-sheet affordance */}
        <div
          aria-hidden
          className={cn(
            'mx-auto mb-3 h-1 w-9 rounded-full sm:hidden',
            isDarkMode ? 'bg-zinc-800' : 'bg-slate-200'
          )}
        />
        <div className="flex flex-col gap-4 min-w-0">
          <LinkTradesHeader count={count} isDarkMode={isDarkMode} onClose={onClose} />
          <LinkTradesSummary count={count} pairCount={pairCount} isDarkMode={isDarkMode} />
          <LinkTradesSetupInput
            value={setupName}
            onChange={onSetupNameChange}
            placeholder={placeholderName}
            isDarkMode={isDarkMode}
          />
          {mixedState && (
            <LinkTradesNotice kind="warn" isDarkMode={isDarkMode}>
              Some trades are already in other setups. Linking will move them into this new setup.
            </LinkTradesNotice>
          )}
          {!mixedState && alreadyLinked && (
            <LinkTradesNotice kind="info" isDarkMode={isDarkMode}>
              These trades are already linked. Confirming creates a fresh setup.
            </LinkTradesNotice>
          )}
          <LinkTradesActions
            count={count}
            disabled={!canConfirm}
            isDarkMode={isDarkMode}
            onCancel={onClose}
            onConfirm={onConfirm}
          />
        </div>
      </div>
    </div>
  );
};

export default LinkTradesCard;
