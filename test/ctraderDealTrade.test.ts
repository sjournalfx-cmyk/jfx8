import { describe, expect, it } from 'vitest';
import { buildCtraderDealTrade, ctraderDealSymbolName } from '../lib/ctraderDealTrade';

const deal = {
  dealId: 9001,
  orderId: 7001,
  symbol: '1',
  symbolId: 1,
  tradeSide: 'buy' as const,
  volume: 0.25,
  price: 1.105,
  entryPrice: 1.1,
  profit: 10,
  swap: -1,
  commission: 0.5,
  stopLoss: 1.09,
  takeProfit: 1.12,
  openTimestamp: '2026-10-20T08:00:00.000Z',
  closeTimestamp: '2026-10-20T10:00:00.000Z',
};

describe('buildCtraderDealTrade', () => {
  it('maps a closed deal into the journal Trade shape', () => {
    const trade = buildCtraderDealTrade(deal, {
      portfolioId: 'portfolio-1',
      symbolsList: [{ symbolId: 1, symbolName: 'EURUSD' }],
    });

    expect(trade.portfolio_id).toBe('portfolio-1');
    expect(trade.ticketId).toBe('9001');
    expect(trade.pair).toBe('EURUSD');
    expect(trade.direction).toBe('Long');
    expect(trade.entryPrice).toBe(1.1);
    expect(trade.exitPrice).toBe(1.105);
    expect(trade.lots).toBe(0.25);
    expect(trade.pnl).toBe(9.5);
    expect(trade.result).toBe('Win');
    expect(trade.tags).toContain('cTrader');
    expect(trade.notes).toContain('Deal #9001');
    expect(trade.notes).toContain('Order #7001');
    expect(trade.openTime).toBe(deal.openTimestamp);
    expect(trade.closeTime).toBe(deal.closeTimestamp);
  });

  it('resolves a symbol id against the cTrader symbol list', () => {
    expect(ctraderDealSymbolName({ symbolId: 2 }, [{ symbolId: 2, symbolName: 'GBPUSD' }])).toBe('GBPUSD');
  });

  it('keeps a named symbol and falls back safely', () => {
    expect(ctraderDealSymbolName({ symbol: 'XAUUSD' })).toBe('XAUUSD');
    expect(ctraderDealSymbolName({})).toBe('EURUSD');
  });

  it('marks a losing short deal correctly', () => {
    const trade = buildCtraderDealTrade({ ...deal, tradeSide: 'sell', profit: -5, swap: 0, commission: 0 });
    expect(trade.direction).toBe('Short');
    expect(trade.pnl).toBe(-5);
    expect(trade.result).toBe('Loss');
  });
});
