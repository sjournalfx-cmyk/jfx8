import { useMemo } from 'react';
import type { Portfolio, UserProfile } from '../types';
import { hasActiveSession } from '../services/ctraderService';

export type BrokerConnectionKind = 'deriv' | 'ctrader' | 'bridge';

export interface BrokerConnectionInput {
  userProfile?: UserProfile | null;
  portfolios?: Portfolio[];
  ctraderAccountId?: string | null;
}

const normalizeProvider = (provider: string | undefined): string =>
  (provider || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Resolve the first live broker/prop connection we know about.
 *
 * - Deriv: an account linked to a portfolio as `provider: "deriv"`.
 * - cTrader: a linked cTrader account, the selected account id, or an active
 *   OAuth session (the same marker the trading views use).
 * - Desktop bridge: the EA profile flag, or a linked bridge/MT4/MT5 account.
 */
export function detectBrokerConnection({
  userProfile,
  portfolios = [],
  ctraderAccountId = null,
}: BrokerConnectionInput): BrokerConnectionKind | null {
  const providers = portfolios.flatMap((portfolio) =>
    (portfolio.accounts || []).map((account) => normalizeProvider(account.provider)),
  );

  if (providers.some((provider) => provider.includes('deriv'))) {
    return 'deriv';
  }

  if (
    Boolean(ctraderAccountId) ||
    providers.some((provider) => provider.includes('ctrader')) ||
    hasActiveSession()
  ) {
    return 'ctrader';
  }

  if (
    Boolean(userProfile?.eaConnected) ||
    providers.some(
      (provider) =>
        provider.includes('bridge') ||
        provider.startsWith('mt4') ||
        provider.startsWith('mt5'),
    )
  ) {
    return 'bridge';
  }

  return null;
}

export function useBrokerConnection(input: BrokerConnectionInput): BrokerConnectionKind | null {
  const { userProfile, portfolios, ctraderAccountId } = input;
  return useMemo(
    () => detectBrokerConnection({ userProfile, portfolios, ctraderAccountId }),
    [userProfile, portfolios, ctraderAccountId],
  );
}
