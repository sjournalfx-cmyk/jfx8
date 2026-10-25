import type { PortfolioSource } from '../types';
import { DESKTOP_BRIDGE_ENABLED } from '../config/features';

export type ViewAfterPortfolioCreate = 'log-trade' | 'ea-setup' | null;

/**
 * Where to land after creating a portfolio.
 *
 * Manual portfolios stay where they were. cTrader goes to Log Trade, whose
 * empty state opens the connect flow. The bridge keeps its old connector jump
 * only while the feature is enabled.
 */
export const viewAfterPortfolioCreate = (
  source: PortfolioSource | undefined,
): ViewAfterPortfolioCreate => {
  if (source === 'ctrader') return 'log-trade';
  if (source === 'bridge' && DESKTOP_BRIDGE_ENABLED) return 'ea-setup';
  return null;
};
