import { EASession, Trade, UserProfile } from '../types';
import { APP_CONSTANTS, normalizePlan } from './constants';
import { getSafePnL } from './trade-normalization';

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const getSessionBridgeBalance = (eaSession?: EASession | null): number | null => {
  const balance = eaSession?.data?.account?.balance;
  return isFiniteNumber(balance) ? balance : null;
};

export const isBridgeBalanceSourceAvailable = (
  userProfile?: UserProfile | null,
  eaSession?: EASession | null,
  lastKnownBridgeBalance?: number | null
) => {
  return Boolean(
    userProfile?.syncMethod === 'EA_CONNECT' ||
      userProfile?.eaConnected ||
      isFiniteNumber(lastKnownBridgeBalance) ||
      getSessionBridgeBalance(eaSession) !== null
  );
};

export const resolveBridgeBackedBalance = ({
  userProfile,
  totalPnL,
  eaSession,
  lastKnownBridgeBalance,
  isBridgeOnline = false,
}: {
  userProfile?: UserProfile | null;
  totalPnL: number;
  eaSession?: EASession | null;
  lastKnownBridgeBalance?: number | null;
  isBridgeOnline?: boolean;
}) => {
  const manualBalance = (userProfile?.initialBalance || 0) + totalPnL;
  const sessionBalance = getSessionBridgeBalance(eaSession);
  const hasBridgeSource = isBridgeBalanceSourceAvailable(userProfile, eaSession, lastKnownBridgeBalance);

  if (!hasBridgeSource) return manualBalance;

  if (isBridgeOnline && sessionBalance !== null) return sessionBalance;
  if (isFiniteNumber(lastKnownBridgeBalance)) return lastKnownBridgeBalance;
  if (sessionBalance !== null) return sessionBalance;

  return manualBalance;
};

export const resolveBridgeBackedInitialBalance = ({
  trades,
  userProfile,
  eaSession,
  lastKnownBridgeBalance,
  isBridgeOnline = false,
}: {
  trades: Trade[];
  userProfile?: UserProfile | null;
  eaSession?: EASession | null;
  lastKnownBridgeBalance?: number | null;
  isBridgeOnline?: boolean;
}) => {
  const currentPlan = normalizePlan(userProfile?.plan);
  const canUseBridgeBalance =
    currentPlan === APP_CONSTANTS.PLANS.HOBBY ||
    currentPlan === APP_CONSTANTS.PLANS.STANDARD;

  if (!canUseBridgeBalance) return userProfile?.initialBalance || 0;

  const totalPnL = trades.reduce((sum, trade) => sum + getSafePnL(trade.pnl), 0);
  return resolveBridgeBackedBalance({
    userProfile,
    totalPnL,
    eaSession,
    lastKnownBridgeBalance,
    isBridgeOnline,
  }) - totalPnL;
};
