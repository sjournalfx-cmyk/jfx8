import React from 'react';
import { X } from 'lucide-react';
import { Portfolio, MAX_PORTFOLIOS } from '../../types';
import { PortfolioSwitcher } from '../PortfolioSwitcher';

interface MobilePortfoliosViewProps {
  portfolios: Portfolio[];
  activePortfolioId: string | null;
  defaultPortfolioId: string | null;
  canAddPortfolio?: boolean;
  tradeCounts?: Record<string, number>;
  startCreatingSignal?: number;
  onSelectPortfolioId: (id: string) => void;
  onAddPortfolio: (input: { name: string; description?: string; purpose?: Portfolio['purpose']; source?: Portfolio['source']; startingBalance?: number; currency?: string }) => Promise<Portfolio>;
  onRemovePortfolio: (id: string) => Promise<void>;
  onBack: () => void;
}

/**
 * Dedicated full-page portfolio manager (mobile). The hamburger drawer keeps
 * only the active-portfolio summary + New button; the cards themselves live
 * here with room for stats, sources and the create form.
 */
export const MobilePortfoliosView: React.FC<MobilePortfoliosViewProps> = ({
  portfolios,
  activePortfolioId,
  defaultPortfolioId,
  canAddPortfolio = true,
  tradeCounts,
  startCreatingSignal,
  onSelectPortfolioId,
  onAddPortfolio,
  onRemovePortfolio,
  onBack,
}) => {
  return (
    <div className="pb-24 px-4 pt-4 bg-[#000000] min-h-full">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-black tracking-tight text-white leading-tight">Portfolios</h1>
          <p className="text-[11px] text-zinc-500">
            {portfolios.length} of {MAX_PORTFOLIOS} slots · each keeps its own journal & connection
          </p>
        </div>
        <button
          onClick={onBack}
          aria-label="Close portfolios"
          className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-zinc-400 hover:text-white active:scale-95"
        >
          <X size={18} strokeWidth={2.2} />
        </button>
      </div>

      <div className="mt-3">
        <PortfolioSwitcher
          portfolios={portfolios}
          activeId={activePortfolioId}
          defaultId={defaultPortfolioId}
          canAdd={canAddPortfolio}
          variant="drawer"
          tradeCounts={tradeCounts}
          startCreatingSignal={startCreatingSignal}
          onSelect={(id) => {
            onSelectPortfolioId(id);
            onBack();
          }}
          onAdd={onAddPortfolio}
          onRemove={onRemovePortfolio}
        />
      </div>
    </div>
  );
};
