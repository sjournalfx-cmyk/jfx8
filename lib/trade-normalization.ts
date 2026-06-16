import { Trade, AssetType } from '../types';
import { calculatePnL, calculateRiskReward, getSessionFromTime } from './trade-calculations';

const DEFAULT_DATE = '1970-01-01';
const DEFAULT_TIME = '00:00';

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const toSafeString = (value: unknown, fallback = ''): string => {
  return typeof value === 'string' ? value : fallback;
};

const toStringArray = (value: unknown, fallback: string[] = []): string[] => {
  if (!Array.isArray(value)) return fallback;
  return value
    .map(item => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
};

const toOptionalString = (value: unknown, fallback?: string): string | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof fallback === 'string') {
    const trimmed = fallback.trim();
    return trimmed || undefined;
  }
  return undefined;
};

const resolveOptionalString = (
  trade: Partial<Trade>,
  fallback: Partial<Trade>,
  key: keyof Pick<Trade, 'openTime' | 'closeTime' | 'notes' | 'exitComment' | 'voiceNote' | 'beforeScreenshot' | 'afterScreenshot' | 'setupId' | 'setupName' | 'deletedAt'>
) => {
  if (Object.prototype.hasOwnProperty.call(trade, key)) {
    return toOptionalString(trade[key], undefined);
  }
  return toOptionalString(fallback[key], undefined);
};

const toOptionalFiniteNumber = (value: unknown, fallback?: number): number | undefined => {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const normalizeResult = (value: unknown): Trade['result'] | undefined => {
  if (value === 'Win' || value === 'Loss' || value === 'BE' || value === 'Pending') {
    return value;
  }
  return undefined;
};

const normalizeDirection = (value: unknown, fallback: Trade['direction'] = 'Long'): Trade['direction'] => {
  return value === 'Short' ? 'Short' : value === 'Long' ? 'Long' : fallback;
};

const normalizeAssetType = (value: unknown, fallback: AssetType = 'Forex'): AssetType => {
  return value === 'Forex' || value === 'Indices' || value === 'Commodities' || value === 'Crypto' || value === 'Stocks'
    ? value
    : fallback;
};

const hasExitContext = (trade: Partial<Trade>) => {
  return trade.exitPrice !== undefined || trade.result === 'Win' || trade.result === 'Loss' || trade.result === 'BE';
};

const deriveResult = (trade: Partial<Trade>, pnl: number): Trade['result'] => {
  if (!hasExitContext(trade)) return 'Pending';
  if (Math.abs(pnl) < 0.000001) return 'BE';
  return pnl > 0 ? 'Win' : 'Loss';
};

type NormalizeTradeOptions = {
  preserveProvidedPnl?: boolean;
};

export const getSafePnL = (value: unknown): number => toFiniteNumber(value, 0);

export const normalizeTrade = (
  trade: Partial<Trade>,
  fallback: Partial<Trade> = {},
  options: NormalizeTradeOptions = {}
): Trade => {
  const assetType = normalizeAssetType(trade.assetType, normalizeAssetType(fallback.assetType));
  const date = toSafeString(trade.date, toSafeString(fallback.date, DEFAULT_DATE));
  const time = toSafeString(trade.time, toSafeString(fallback.time, DEFAULT_TIME));
  const sessionCandidate = toSafeString(trade.session, toSafeString(fallback.session, ''));
  const session = sessionCandidate || getSessionFromTime(time);
  const direction = normalizeDirection(trade.direction, normalizeDirection(fallback.direction));
  const entryPrice = toFiniteNumber(trade.entryPrice, toFiniteNumber(fallback.entryPrice, 0));
  const exitPrice = toOptionalFiniteNumber(trade.exitPrice, fallback.exitPrice);
  const stopLoss = toFiniteNumber(trade.stopLoss, toFiniteNumber(fallback.stopLoss, 0));
  const takeProfit = toFiniteNumber(trade.takeProfit, toFiniteNumber(fallback.takeProfit, 0));
  const lots = toFiniteNumber(trade.lots, toFiniteNumber(fallback.lots, 0));

  const tradeForCalc: Partial<Trade> = {
    ...fallback,
    ...trade,
    assetType,
    direction,
    entryPrice,
    exitPrice,
    stopLoss,
    takeProfit,
    lots,
  };

  const calculatedPnl = getSafePnL(calculatePnL(tradeForCalc));
  const explicitPnl = toOptionalFiniteNumber(trade.pnl, toOptionalFiniteNumber(fallback.pnl));
  const shouldPreserveExplicitPnl = options.preserveProvidedPnl !== false;
  const rawPnl = shouldPreserveExplicitPnl && explicitPnl !== undefined ? explicitPnl : calculatedPnl;

  const explicitResult = normalizeResult(trade.result) ?? normalizeResult(fallback.result);
  const result = explicitResult === 'Pending' && hasExitContext(tradeForCalc)
    ? deriveResult(tradeForCalc, rawPnl)
    : explicitResult ?? deriveResult(tradeForCalc, rawPnl);

  // Sync PNL sign with outcome result (WIN/LOSS)
  let pnl = rawPnl;
  if (result === 'Loss') {
    pnl = -Math.abs(rawPnl);
  } else if (result === 'Win') {
    pnl = Math.abs(rawPnl);
  }

  const rrMetrics = calculateRiskReward({
    entryPrice,
    stopLoss,
    takeProfit,
    exitPrice,
    lots,
    assetType,
    direction,
  });

  return {
    id: toSafeString(trade.id, toSafeString(fallback.id, '')),
    ticketId: toOptionalString(trade.ticketId, fallback.ticketId),
    pair: toSafeString(trade.pair, toSafeString(fallback.pair, '')).toUpperCase(),
    assetType,
    date,
    time,
    session,
    direction,
    entryPrice,
    exitPrice,
    stopLoss,
    takeProfit,
    lots,
    result,
    pnl,
    commissions: toOptionalFiniteNumber(trade.commissions, fallback.commissions),
    fees: toOptionalFiniteNumber(trade.fees, fallback.fees),
    swap: toOptionalFiniteNumber(trade.swap, fallback.swap),
    rr: toFiniteNumber(trade.rr, toFiniteNumber(fallback.rr, rrMetrics.rr)),
    rating: Math.max(0, toFiniteNumber(trade.rating, toFiniteNumber(fallback.rating, 0))),
    openTime: resolveOptionalString(trade, fallback, 'openTime'),
    closeTime: resolveOptionalString(trade, fallback, 'closeTime'),
    tags: toStringArray(trade.tags, toStringArray(fallback.tags, [])),
    notes: resolveOptionalString(trade, fallback, 'notes'),
    emotions: toStringArray(trade.emotions, toStringArray(fallback.emotions, [])),
    planAdherence: (trade.planAdherence ?? fallback.planAdherence ?? 'No Plan') as Trade['planAdherence'],
    tradingMistake: toOptionalString(trade.tradingMistake, fallback.tradingMistake) ?? 'None',
    mindset: toOptionalString(trade.mindset, fallback.mindset) ?? 'Neutral',
    exitComment: resolveOptionalString(trade, fallback, 'exitComment'),
    voiceNote: resolveOptionalString(trade, fallback, 'voiceNote'),
    beforeScreenshot: resolveOptionalString(trade, fallback, 'beforeScreenshot'),
    afterScreenshot: resolveOptionalString(trade, fallback, 'afterScreenshot'),
    setupId: resolveOptionalString(trade, fallback, 'setupId'),
    setupName: resolveOptionalString(trade, fallback, 'setupName'),
    deletedAt: resolveOptionalString(trade, fallback, 'deletedAt'),
  };
};
