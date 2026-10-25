import { Trade } from '../types';
import { getSASTDateTime } from './timeUtils';
import { normalizeTrade } from './trade-normalization';

export interface CtraderSymbol {
  symbolId?: number | string;
  symbolName?: string;
}

export interface BuildCtraderDealTradeOptions {
  portfolioId?: string | null;
  symbolsList?: CtraderSymbol[];
}

/** Resolve a closed cTrader deal's symbol name, falling back to the deal payload. */
export const ctraderDealSymbolName = (deal: any, symbolsList: CtraderSymbol[] = []): string => {
  if (deal?.symbol && isNaN(Number(deal.symbol))) {
    return deal.symbol;
  }
  const targetId = deal?.symbolId !== undefined ? deal.symbolId : deal?.symbol;
  if (targetId !== undefined && targetId !== null) {
    const found = symbolsList.find((symbol) => String(symbol.symbolId) === String(targetId));
    if (found?.symbolName) {
      return found.symbolName;
    }
  }
  return deal?.symbol || 'EURUSD';
};

/**
 * Map a cTrader closed deal to the journal Trade shape.
 * Kept in one place so the in-terminal auto-sync and the app-wide auto-sync
 * hook produce identical rows.
 */
export const buildCtraderDealTrade = (
  deal: any,
  options: BuildCtraderDealTradeOptions = {},
): Trade => {
  const { portfolioId, symbolsList = [] } = options;
  const pairName = ctraderDealSymbolName(deal, symbolsList);
  const netPnL = Number(((deal?.profit ?? 0) + (deal?.swap || 0) + (deal?.commission || 0)).toFixed(2));
  const closeDate = deal?.closeTimestamp ? new Date(deal.closeTimestamp) : new Date();
  const openDate = deal?.openTimestamp ? new Date(deal.openTimestamp) : closeDate;
  const sastClose = getSASTDateTime(closeDate);

  const normalized = normalizeTrade({
    id: '',
    ticketId: String(deal?.dealId || deal?.orderId || Date.now()),
    portfolio_id: portfolioId || undefined,
    pair: pairName,
    assetType: 'Forex',
    date: sastClose.date,
    time: sastClose.fullTime,
    openTime: openDate.toISOString(),
    closeTime: closeDate.toISOString(),
    direction: deal?.tradeSide === 'buy' ? 'Long' : 'Short',
    entryPrice: deal?.entryPrice || deal?.price || 0,
    exitPrice: deal?.price || 0,
    stopLoss: deal?.stopLoss || 0,
    takeProfit: deal?.takeProfit || 0,
    lots: deal?.volume || 0.01,
    result: netPnL > 0 ? 'Win' : netPnL < 0 ? 'Loss' : 'BE',
    pnl: netPnL,
    rr: 0,
    rating: 0,
    tags: ['cTrader'],
    notes: `Synced from cTrader. Deal #${deal?.dealId} | Order #${deal?.orderId}`,
    planAdherence: 'No Plan',
    tradingMistake: 'None',
    mindset: 'Neutral',
  });

  // normalizeTrade does not carry portfolio_id, but every broker row must
  // land in the linked portfolio on the first insert, not Default.
  return portfolioId ? { ...normalized, portfolio_id: portfolioId } : normalized;
};
