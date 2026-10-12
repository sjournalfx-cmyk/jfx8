import React from 'react';
import { X } from 'lucide-react';
import { CtraderTradeTab } from './CtraderTradeTab';
import type { CtraderQuoteSymbol } from '../../hooks/useCtraderSymbols';
import { haptic } from '../../lib/haptics';

interface CtraderTradeDetailProps {
  ctidAccountId?: string | null;
  isDemoMode?: boolean;
  symbols: CtraderQuoteSymbol[];
  isDemo: boolean;
  isLoadingSymbols: boolean;
  symbolsError: string | null;
  symbolId: number | null;
  onSymbolChange: (id: number | null) => void;
  onRefreshSymbols: () => void;
  onClose: () => void;
  onGoConnect?: () => void;
  portfolioId?: string | null;
  timezone?: string;
}

/**
 * Full-screen trade page opened from a Quotes row: market execution for the
 * chosen pair only. Position management lives on the Trade tab account card.
 * Closed via X (back to Quotes).
 */
export const CtraderTradeDetail: React.FC<CtraderTradeDetailProps> = ({
  ctidAccountId,
  isDemoMode,
  symbols,
  isDemo,
  isLoadingSymbols,
  symbolsError,
  symbolId,
  onSymbolChange,
  onRefreshSymbols,
  onClose,
  onGoConnect,
  portfolioId,
  timezone,
}) => {
  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#000000]">
      <div className="shrink-0 flex justify-end px-2 pt-2">
        <button
          onClick={() => {
            try {
              haptic.selection();
            } catch {}
            onClose();
          }}
          aria-label="Close trade page"
          className="p-2 rounded-xl text-zinc-400 active:scale-95 active:bg-zinc-900 touch-manipulation"
        >
          <X size={22} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
        <CtraderTradeTab
          ctidAccountId={ctidAccountId}
          isDemoMode={isDemoMode}
          onGoConnect={onGoConnect}
          symbols={symbols}
          isDemo={isDemo}
          isLoadingSymbols={isLoadingSymbols}
          symbolsError={symbolsError}
          symbolId={symbolId}
          onSymbolChange={onSymbolChange}
          onRefreshSymbols={onRefreshSymbols}
          compact
          portfolioId={portfolioId}
          timezone={timezone}
        />
      </div>
    </div>
  );
};
