import React from 'react';
import { CtraderLogTradeTabs } from '../mobile/CtraderLogTradeTabs';
import { NoConnectionState } from '../log-trade/NoConnectionState';
import { useTradingNotifications } from '../../hooks/useTradingNotifications';

interface DesktopCtraderLogTradeProps {
  ctidAccountId?: string | null;
  isDemoMode?: boolean;
  onGoConnect?: () => void;
  portfolioId?: string | null;
  timezone?: string;
}

/**
 * Desktop Log Trade for cTrader portfolios: the same Quotes/Trade tabs used
 * on mobile, with desktop spacing and chart fullscreen.
 */
const DesktopCtraderLogTrade: React.FC<DesktopCtraderLogTradeProps> = ({
  ctidAccountId,
  isDemoMode,
  onGoConnect,
  portfolioId,
  timezone,
}) => {
  const { notify } = useTradingNotifications();

  return (
    <div className="h-full overflow-hidden bg-[#0a0a0a] p-4 lg:p-6">
      <div className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-black">
        {ctidAccountId ? (
          <CtraderLogTradeTabs
            ctidAccountId={ctidAccountId}
            isDemoMode={isDemoMode}
            onGoConnect={onGoConnect}
            portfolioId={portfolioId}
            timezone={timezone}
            desktop
            onTradingEvent={notify}
          />
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <NoConnectionState onConnect={onGoConnect} />
          </div>
        )}
      </div>
    </div>
  );
};

export default DesktopCtraderLogTrade;
