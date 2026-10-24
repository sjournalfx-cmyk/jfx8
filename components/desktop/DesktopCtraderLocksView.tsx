import React from 'react';
import { Lock } from 'lucide-react';
import { TradingLocks } from '../discipline/TradingLocks';
import { CtraderConnectPrompt } from './CtraderConnectPrompt';
import type { Portfolio } from '../../types';

interface DesktopCtraderLocksViewProps {
  portfolios: Portfolio[];
  activePortfolioId?: string | null;
  resolveCtraderAccountId: (portfolioId: string) => string | null;
  timezone?: string;
  hasCtraderAccount?: boolean;
  onGoConnect?: () => void;
}

/** Desktop entry for the existing Trading Locks discipline panel. */
export const DesktopCtraderLocksView: React.FC<DesktopCtraderLocksViewProps> = ({
  portfolios,
  activePortfolioId,
  resolveCtraderAccountId,
  timezone,
  hasCtraderAccount = false,
  onGoConnect,
}) => (
  <div className="h-full overflow-y-auto bg-[#0a0a0a] p-4 lg:p-6">
    <div className="mx-auto max-w-3xl">
      <header className="mb-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FF4F01]/15 text-[#FF4F01]">
            <Lock size={16} />
          </span>
          <h1 className="text-2xl font-black tracking-tight text-white">Trading Locks</h1>
        </div>
        <p className="mt-1 text-sm text-zinc-500">
          Hard limits enforced by the order ticket. Lock changes stay active for 24 hours; closes and SL/TP edits always work.
        </p>
      </header>

      {hasCtraderAccount ? (
        <div className="rounded-2xl border border-white/10 bg-[#0b0b0c] p-4">
          <TradingLocks
            portfolios={portfolios}
            activePortfolioId={activePortfolioId}
            resolveCtraderAccountId={resolveCtraderAccountId}
            timezone={timezone}
            onGoConnect={onGoConnect}
          />
        </div>
      ) : (
        <CtraderConnectPrompt
          title="Connect cTrader to set trading locks"
          description="Trading locks apply to cTrader portfolios. Connect an account first, then cap pairs, trade count, and lot size."
          onGoConnect={onGoConnect}
        />
      )}
    </div>
  </div>
);

export default DesktopCtraderLocksView;
