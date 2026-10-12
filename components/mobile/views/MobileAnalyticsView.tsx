import React from 'react';
import Analytics from '../../Analytics';
import { Trade, UserProfile, EASession, CashTransaction } from '../../../types';
import { type PsychologyInsightsEntry } from '../../../lib/psychologyInsights';

interface MobileAnalyticsViewProps {
  trades: Trade[];
  userProfile: UserProfile;
  isDarkMode?: boolean;
  onViewChange?: (view: string) => void;
  eaSession?: EASession | null;
  lastKnownBridgeBalance?: import('../../../lib/bridgeBalance').StoredBridgeBalance | number | null;
  isBridgeOnline?: boolean;
  cashTransactions?: CashTransaction[];
  dailyPsychologyInsights?: PsychologyInsightsEntry | null;
  onRefreshPsychologyInsights?: () => void;
  isRefreshingPsychologyInsights?: boolean;
  psychologyAnalyzeLimitReached?: boolean;
  isDemoMode?: boolean;
  activeTabOverride?: 'overview' | 'trades' | 'psychology' | 'compliance' | 'session' | 'comparison' | 'reports' | 'cash';
  hideTopChrome?: boolean;
}

/**
 * Mobile wrapper for Performance Analytics.
 * Delegates entirely to the shared <Analytics /> component so the mobile Home > Analytics
 * sub-tab renders exactly the same 8-tab sticky scroller as desktop (Tasks 12).
 * Previously this view duplicated widget logic (SymbolPerformance, PairDistribution etc.) —
 * now it simply forwards props to Analytics to avoid drift.
 */
export const MobileAnalyticsView: React.FC<MobileAnalyticsViewProps> = ({
  trades,
  userProfile,
  isDarkMode = true,
  onViewChange = () => {},
  eaSession = null,
  lastKnownBridgeBalance = null,
  isBridgeOnline = false,
  cashTransactions = [],
  dailyPsychologyInsights = null,
  onRefreshPsychologyInsights,
  isRefreshingPsychologyInsights = false,
  psychologyAnalyzeLimitReached = false,
  isDemoMode = false,
  activeTabOverride,
  hideTopChrome = false,
}) => {
  return (
    <Analytics
      isDarkMode={isDarkMode}
      trades={trades}
      userProfile={userProfile}
      onViewChange={onViewChange}
      eaSession={eaSession}
      lastKnownBridgeBalance={lastKnownBridgeBalance}
      isBridgeOnline={isBridgeOnline}
      cashTransactions={cashTransactions}
      dailyPsychologyInsights={dailyPsychologyInsights}
      onRefreshPsychologyInsights={onRefreshPsychologyInsights}
      isRefreshingPsychologyInsights={isRefreshingPsychologyInsights}
      psychologyAnalyzeLimitReached={psychologyAnalyzeLimitReached}
      isDemoMode={isDemoMode}
      activeTabOverride={activeTabOverride}
      hideTopChrome={hideTopChrome}
    />
  );
};
