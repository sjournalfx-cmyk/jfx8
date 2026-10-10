import { Trade, AssetType } from '../types';

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const resolveExitPrice = (trade: Partial<Trade>): number => {
  const { exitPrice, result, stopLoss, takeProfit, entryPrice } = trade;

  if (exitPrice !== undefined && exitPrice !== null && Number.isFinite(Number(exitPrice))) {
    return Number(exitPrice);
  }

  if (result === 'Win') return toFiniteNumber(takeProfit, toFiniteNumber(entryPrice, 0));
  if (result === 'Loss') return toFiniteNumber(stopLoss, toFiniteNumber(entryPrice, 0));

  return toFiniteNumber(entryPrice, 0);
};

/**
 * Returns pip size and approximate USD pip value per standard lot for a Forex pair.
 * JPY-quoted pairs (e.g. GBPJPY, USDJPY, EURJPY) use pip size 0.01 and ~$6.50/pip/lot.
 * All other pairs use pip size 0.0001 and $10/pip/lot.
 */
const getForexPipInfo = (pair?: string): { pipSize: number; pipValuePerLot: number } => {
  const sym = (pair || '').toUpperCase().replace('/', '');
  // JPY is always the quote currency in 6-char pairs ending in JPY
  if (sym.length >= 6 && sym.slice(-3) === 'JPY') {
    return { pipSize: 0.01, pipValuePerLot: 6.5 };
  }
  // Standard USD-quoted or EUR/GBP/AUD/NZD/CHF quoted pairs
  return { pipSize: 0.0001, pipValuePerLot: 10 };
};

/**
 * Returns the price increment that counts as "1 pip" for a given trade.
 * Forex:   JPY-quoted = 0.01, everything else = 0.0001
 * Gold:    0.1  (XAUUSD quotes move in cents)
 * Silver:  0.01 (XAGUSD)
 * Energy:  0.01 (oil / gas)
 * Indices / Crypto / Stocks: 1 point (whole index or coin tick)
 * Honors an explicit trade.contractSize-style broker override for the quote unit
 * via trade.pair conventions only — contractSize scales PnL, not pip size.
 */
export const getPipSize = (assetType?: string, pair?: string): number => {
  const sym = (pair || '').toUpperCase().replace('/', '').replace('_', '');

  if (assetType === 'Forex' || (!assetType && /^[A-Z]{6}$/.test(sym))) {
    const { pipSize } = getForexPipInfo(sym);
    return pipSize;
  }

  if (assetType === 'Commodities') {
    if (sym.includes('XAU') || sym.includes('GOLD')) return 0.1;
    if (sym.includes('XAG') || sym.includes('SILVER')) return 0.01;
    return 0.01; // oil, gas and other energy quotes
  }

  // Indices, Crypto and Stocks are quoted in whole points/units.
  return 1;
};

/**
 * Returns the standard contract multiplier for non-Forex assets.
 * This is the number of units (oz, barrels, contracts) per 1 lot.
 * Traders can override this per-trade via trade.contractSize for non-standard brokers.
 *
 * Commodities:
 *   XAUUSD / GOLD   = 100 oz/lot   → $1 move = $100/lot
 *   XAGUSD / SILVER = 5000 oz/lot  → $1 move = $5000/lot
 *   OIL / WTI / USOIL / BRENT = 1000 bbl/lot
 *   NG / NGAS / NATGAS = 10000 MMBtu/lot
 * Indices (CFD, most brokers):
 *   1 lot = 1 contract = $1/point (US30, NAS100, SPX500, etc.)
 * Crypto:
 *   1 lot = 1 coin (BTC, ETH, etc.) — adjust via contractSize for mini-lot brokers
 * Stocks:
 *   1 lot = 1 share by default
 */
const getContractMultiplier = (assetType: string | undefined, pair?: string): number => {
  if (assetType === 'Commodities') {
    const sym = (pair || '').toUpperCase().replace('/', '').replace('_', '');
    if (sym.includes('XAU') || sym.includes('GOLD')) return 100;
    if (sym.includes('XAG') || sym.includes('SILVER')) return 5000;
    if (sym.includes('WTI') || sym.includes('USOIL') || sym.includes('OIL') || sym.includes('BRENT') || sym.includes('UKOIL')) return 1000;
    if (sym.includes('NG') || sym.includes('NGAS') || sym.includes('NATGAS')) return 10000;
    return 1; // unknown commodity — treat as 1:1
  }
  // Indices (CFD): 1 lot = 1 contract = 1 point value
  if (assetType === 'Indices') return 1;
  // Crypto / Stocks: 1 lot = 1 unit
  return 1;
};

const calculateDirectionalPnL = (trade: Partial<Trade>, exit: number): number => {
  const assetType = trade.assetType;
  const entryPrice = toFiniteNumber(trade.entryPrice, NaN);
  const lots = toFiniteNumber(trade.lots, 0);
  const direction = trade.direction;

  if (!Number.isFinite(entryPrice) || !lots || !assetType) return 0;

  const diff = direction === 'Long' ? (exit - entryPrice) : (entryPrice - exit);

  switch (assetType) {
    case 'Forex': {
      const { pipSize, pipValuePerLot } = getForexPipInfo(trade.pair);
      // pips = price diff / pipSize; PnL = pips * pipValuePerLot * lots
      return (diff / pipSize) * pipValuePerLot * lots;
    }
    default: {
      // For Indices, Commodities, Crypto, Stocks:
      // Use per-trade contractSize override if provided, otherwise use symbol-based lookup.
      const multiplier = toFiniteNumber(trade.contractSize, 0) > 0
        ? toFiniteNumber(trade.contractSize, 1)
        : getContractMultiplier(assetType, trade.pair);
      return diff * multiplier * lots;
    }
  }
};

export const calculatePnL = (trade: Partial<Trade>): number => {
  return calculateDirectionalPnL(trade, resolveExitPrice(trade));
};

export const calculatePnLAtPrice = (trade: Partial<Trade>, exitPrice: number): number => {
  return calculateDirectionalPnL(trade, exitPrice);
};

export const calculateRiskReward = (formData: any) => {
    const entry = parseFloat(formData.entryPrice);
    const sl = parseFloat(formData.stopLoss);
    const tp = parseFloat(formData.takeProfit);
    const exit = parseFloat(formData.exitPrice);
    const lots = parseFloat(formData.lots) || 0;

    if (entry && sl && (tp || exit)) {
        const targetExit = exit || tp;
        const riskDist = Math.abs(entry - sl);
        const rewardDist = Math.abs(targetExit - entry);
        const rrRatio = riskDist > 0 ? rewardDist / riskDist : 0;

        const riskPnL = calculatePnLAtPrice({
          ...formData,
          entryPrice: entry,
          stopLoss: sl,
          lots,
          result: 'Loss'
        } as any, sl);

        const rewardPnL = calculatePnLAtPrice({
          ...formData,
          entryPrice: entry,
          takeProfit: targetExit,
          lots,
          result: 'Win'
        } as any, targetExit);

        return {
            risk: Math.abs(riskPnL),
            reward: Math.abs(rewardPnL),
            rr: parseFloat(rrRatio.toFixed(2))
        };
    }
    
    return { risk: 0, reward: 0, rr: 0 };
};

export const getSessionFromTime = (time: string): string => {
    const [h] = time.split(':').map(Number);
    const hour = h;

    if (!Number.isFinite(hour)) return 'London Session';
    if (hour >= 0 && hour < 9) return 'Asian Session';
    if (hour >= 9 && hour < 15) return 'London Session';
    if (hour >= 15 && hour < 18) return 'London/NY Overlap';
    if (hour >= 18 && hour < 24) return 'New York Session';

    return 'London Session';
};
