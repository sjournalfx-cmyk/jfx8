import { EASession, Trade, UserProfile } from '../types';
import { APP_CONSTANTS, normalizePlan } from './constants';
import { getSafePnL } from './trade-normalization';

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

// How long a persisted bridge balance snapshot stays trustworthy. After this,
// journal math (initialBalance + PnL) takes over until the next live sync.
export const BRIDGE_BALANCE_MAX_AGE_MS = 7 * 86400000; // 7 days

export interface StoredBridgeBalance {
  v: 1;
  balance: number;
  capturedAt: string; // ISO timestamp of the last successful bridge sync
}

/**
 * Accepts both the current object shape and the legacy bare-number shape.
 * Legacy numbers have no timestamp → treated as infinitely old (stale).
 */
export const parseStoredBridgeBalance = (
  stored: unknown
): { balance: number; ageMs: number } | null => {
  if (stored && typeof stored === 'object') {
    const o = stored as { v?: number; balance?: unknown; capturedAt?: string };
    const bal = toFinite(o.balance);
    if (bal === null) return null;
    const t = Date.parse(o.capturedAt || '');
    return { balance: bal, ageMs: Number.isFinite(t) ? Date.now() - t : Infinity };
  }
  const legacy = toFinite(stored);
  return legacy !== null ? { balance: legacy, ageMs: Infinity } : null;
};

const toFinite = (value: unknown): number | null =>
  isFiniteNumber(value) ? value : null;

export const getSessionBridgeBalance = (eaSession?: EASession | null): number | null => {
  const balance = eaSession?.data?.account?.balance;
  return isFiniteNumber(balance) ? balance : null;
};

export const isBridgeBalanceSourceAvailable = (
  userProfile?: UserProfile | null,
  eaSession?: EASession | null
) => {
  // A genuinely active bridge connection is the only authoritative source.
  // A bare stored snapshot no longer qualifies on its own — it may be stale
  // or belong to a previous account.
  if (!userProfile?.eaConnected && userProfile?.syncMethod === 'EA_CONNECT') return false;
  return Boolean(
    userProfile?.eaConnected ||
    userProfile?.syncMethod === 'EA_CONNECT' ||
    getSessionBridgeBalance(eaSession) !== null
  );
};

export const resolveBridgeBackedBalance = ({
  userProfile,
  totalPnL,
  eaSession,
  lastKnownBridgeBalance,
  isBridgeOnline = false,
  isDemoMode = false,
}: {
  userProfile?: UserProfile | null;
  totalPnL: number;
  eaSession?: EASession | null;
  lastKnownBridgeBalance?: StoredBridgeBalance | number | null;
  isBridgeOnline?: boolean;
  isDemoMode?: boolean;
}) => {
  const manualBalance = (userProfile?.initialBalance || 0) + totalPnL;

  // Demo must show demo-session data only — never a real bridge snapshot that
  // happens to sit in this user's localStorage.
  if (isDemoMode) return manualBalance;

  const sessionBalance = getSessionBridgeBalance(eaSession);
  const hasBridgeSource = isBridgeBalanceSourceAvailable(userProfile, eaSession);
  if (!hasBridgeSource) return manualBalance;

  if (isBridgeOnline && sessionBalance !== null) return sessionBalance;

  const parsed = parseStoredBridgeBalance(lastKnownBridgeBalance ?? null);
  if (parsed && parsed.ageMs <= BRIDGE_BALANCE_MAX_AGE_MS) return parsed.balance;

  if (sessionBalance !== null) return sessionBalance;

  return manualBalance;
};

export const resolveBridgeBackedInitialBalance = ({
  trades,
  userProfile,
  eaSession,
  lastKnownBridgeBalance,
  isBridgeOnline = false,
  isDemoMode = false,
}: {
  trades: Trade[];
  userProfile?: UserProfile | null;
  eaSession?: EASession | null;
  lastKnownBridgeBalance?: StoredBridgeBalance | number | null;
  isBridgeOnline?: boolean;
  isDemoMode?: boolean;
}) => {
  const currentPlan = normalizePlan(userProfile?.plan);
  // Only Pro (HOBBY) and Premium (STANDARD) tiers sync balance from the broker.
  // FREE tier always uses the manually configured initialBalance.
  const isBrokerSyncTier =
    currentPlan === APP_CONSTANTS.PLANS.HOBBY ||
    currentPlan === APP_CONSTANTS.PLANS.STANDARD;

  if (!isBrokerSyncTier) return userProfile?.initialBalance || 0;

  const totalPnL = trades.reduce((sum, trade) => sum + getSafePnL(trade.pnl), 0);
  return resolveBridgeBackedBalance({
    userProfile,
    totalPnL,
    eaSession,
    lastKnownBridgeBalance,
    isBridgeOnline,
    isDemoMode,
  }) - totalPnL;
};
