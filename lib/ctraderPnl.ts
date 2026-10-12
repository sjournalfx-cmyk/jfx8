/**
 * Utilities for calculating live real-time P&L (Profit & Loss) and price formatting
 * for cTrader open positions, matching MetaTrader 5 (MT5) live ticking behavior.
 */

/**
 * Returns standard contract size (units per 1.0 lot) for a financial instrument.
 */
export function getContractSize(symbolName: string): number {
  const clean = (symbolName || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.includes('XAU') || clean.includes('GOLD')) return 100; // 100 oz per lot
  if (clean.includes('XAG') || clean.includes('SILVER')) return 5000; // 5,000 oz per lot
  if (clean.includes('BTC') || clean.includes('ETH') || clean.includes('SOL') || clean.includes('CRYPTO')) return 1;
  if (
    clean.includes('US30') || clean.includes('DJ30') ||
    clean.includes('NAS100') || clean.includes('US100') ||
    clean.includes('SPX500') || clean.includes('US500') ||
    clean.includes('GER40') || clean.includes('GER30') || clean.includes('DAX') ||
    clean.includes('UK100') || clean.includes('FTSE')
  ) {
    return 1;
  }
  if (clean.includes('OIL') || clean.includes('BRENT') || clean.includes('WTI')) return 1000; // 1,000 barrels
  // Standard Forex currency pairs (EURUSD, GBPUSD, USDJPY, AUDCAD, etc.): 100,000 units
  return 100000;
}

/**
 * Normalizes raw wire price from cTrader ProtoOA (scaled integer) to a human floating price.
 * For example: EURUSD with digits=5: wire 108542 -> 1.08542.
 * If raw is already a floating point number (e.g. less than 1000 for standard forex, or already divided),
 * handles it gracefully.
 */
export function toHumanPrice(raw: unknown, digits: number): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  
  // Wire prices in ProtoOASpotEvent are integers scaled by 10^digits.
  // For example: EURUSD (digits=5) price 1.08542 is sent as 108542.
  // JPY pairs (digits=3) price 152.350 is sent as 152350.
  // If n is already small (e.g. n < 500 when digits >= 4), it might already be human float.
  if (digits >= 4 && n < 500) {
    return n;
  }
  return n / Math.pow(10, digits);
}

export interface LivePositionCalcResult {
  currentPrice: number;
  liveProfit: number;
  floating: number;
  priceDelta: number;
  formattedCurrentPrice: string;
  formattedOpenPrice: string;
}

/**
 * Calculates live ticking floating profit for an open position given the latest live quotes.
 *
 * @param pos Position details (tradeSide, volume, openPrice, profit, swap, commission)
 * @param liveBidRaw Raw wire bid from live spot stream (scaled integer)
 * @param liveAskRaw Raw wire ask from live spot stream (scaled integer)
 * @param digits Symbol digits (e.g. 5 for EURUSD, 3 for USDJPY, 2 for XAUUSD)
 */
export function calculateLivePositionProfit(
  pos: {
    symbol?: string;
    tradeSide?: 'buy' | 'sell' | string;
    volume?: number;
    openPrice?: number;
    currentPrice?: number;
    profit?: number;
    swap?: number;
    commission?: number;
  },
  liveBidRaw?: number,
  liveAskRaw?: number,
  digits: number = 5
): LivePositionCalcResult {
  const isBuy = String(pos.tradeSide || '').toLowerCase() === 'buy';
  let openPrice = Number(pos.openPrice ?? 0);
  if (digits >= 4 && openPrice > 500) {
    openPrice = openPrice / Math.pow(10, digits);
  } else if (digits === 3 && openPrice > 1000) {
    openPrice = openPrice / Math.pow(10, digits);
  } else if (digits === 2 && openPrice > 100000) {
    openPrice = openPrice / Math.pow(10, digits);
  }

  const volumeLots = Number(pos.volume ?? 0);
  const swap = Number(pos.swap ?? 0);
  const commission = Number(pos.commission ?? 0);
  const serverProfit = Number(pos.profit ?? 0);

  const currentBid = toHumanPrice(liveBidRaw, digits);
  const currentAsk = toHumanPrice(liveAskRaw, digits);

  // Buy closes at Bid; Sell closes at Ask
  const fallbackRaw = pos.currentPrice ?? pos.openPrice;
  const fallbackPrice = toHumanPrice(fallbackRaw, digits) ?? openPrice;
  let currentPrice: number;
  if (isBuy) {
    currentPrice = currentBid ?? (currentAsk ? currentAsk : fallbackPrice);
  } else {
    currentPrice = currentAsk ?? (currentBid ? currentBid : fallbackPrice);
  }

  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    currentPrice = openPrice;
  }

  const priceDelta = isBuy ? (currentPrice - openPrice) : (openPrice - currentPrice);

  let liveProfit = serverProfit;

  // Real-time tick calculation if we have live quote and valid position info
  if (Number.isFinite(currentPrice) && Number.isFinite(openPrice) && openPrice > 0 && volumeLots > 0) {
    const symbolName = pos.symbol || '';
    const contractSize = getContractSize(symbolName);
    const cleanSym = symbolName.toUpperCase().replace(/[^A-Z0-9]/g, '');

    // Conversion rate for quote currency to USD (deposit currency)
    let quoteToDeposit = 1.0;
    if (cleanSym.endsWith('JPY')) {
      const usdJpyRate = cleanSym.startsWith('USD') ? currentPrice : 150;
      quoteToDeposit = usdJpyRate > 0 ? 1 / usdJpyRate : 1 / 150;
    } else if (cleanSym.endsWith('CAD')) {
      quoteToDeposit = 1 / 1.37;
    } else if (cleanSym.endsWith('CHF')) {
      quoteToDeposit = 1 / 0.88;
    } else if (cleanSym.endsWith('GBP')) {
      quoteToDeposit = 1.30;
    } else if (cleanSym.endsWith('AUD')) {
      quoteToDeposit = 0.65;
    } else if (cleanSym.endsWith('NZD')) {
      quoteToDeposit = 0.60;
    }

    const calculatedGross = priceDelta * (volumeLots * contractSize) * quoteToDeposit;

    if (currentBid !== undefined || currentAsk !== undefined) {
      // If we have live quote ticks, use the real-time calculated gross profit
      liveProfit = calculatedGross;
    }
  }

  const floating = liveProfit + swap + commission;

  const formattedCurrentPrice = Number.isFinite(currentPrice) && currentPrice > 0
    ? currentPrice.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : '—';

  const formattedOpenPrice = Number.isFinite(openPrice) && openPrice > 0
    ? openPrice.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : '—';

  return {
    currentPrice,
    liveProfit,
    floating,
    priceDelta,
    formattedCurrentPrice,
    formattedOpenPrice,
  };
}
