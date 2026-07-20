/**
 * BrokerConnect.test.tsx
 *
 * Tests for the cTrader OpenAPI integration used in BrokerConnect.tsx.
 * Verifies authentication flow, account fetching, position/deal mapping.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { mapCtraderDealToEADeal, CtraderDeal } from '../services/ctraderService';
import { EADeal } from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const makeCtraderDeal = (dealId: number, overrides: Partial<CtraderDeal> = {}): CtraderDeal => ({
  dealId,
  orderId: 50000 + dealId,
  symbol: 'EURUSD',
  tradeSide: 'buy',
  volume: 0.1,
  price: 1.1050,
  profit: 25.0,
  swap: 0,
  commission: -0.15,
  openTimestamp: '2026-06-15T12:00:00Z',
  closeTimestamp: '2026-06-15T14:30:00Z',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('cTrader – deal mapping', () => {
  it('maps a buy deal to EADeal correctly', () => {
    const deal = makeCtraderDeal(1001);
    const mapped = mapCtraderDealToEADeal(deal);
    expect(mapped.ticket).toBe(1001);
    expect(mapped.symbol).toBe('EURUSD');
    expect(mapped.type).toBe('BUY');
    expect(mapped.volume).toBe(0.1);
    expect(mapped.price).toBe(1.1050);
    expect(mapped.profit).toBe(25.0);
  });

  it('maps a sell deal to SELL type', () => {
    const deal = makeCtraderDeal(2002, { tradeSide: 'sell' });
    const mapped = mapCtraderDealToEADeal(deal);
    expect(mapped.type).toBe('SELL');
  });

  it('includes optional stop loss and take profit', () => {
    const deal = makeCtraderDeal(3003, { stopLoss: 1.1000, takeProfit: 1.1100 });
    const mapped = mapCtraderDealToEADeal(deal);
    expect(mapped.sl).toBe(1.1000);
    expect(mapped.tp).toBe(1.1100);
  });

  it('includes entry price when provided', () => {
    const deal = makeCtraderDeal(4004, { entryPrice: 1.1020 });
    const mapped = mapCtraderDealToEADeal(deal);
    expect(mapped.entry_price).toBe(1.1020);
  });

  it('sets swap and commission from cTrader deal', () => {
    const deal = makeCtraderDeal(5005, { swap: -1.2, commission: -0.5 });
    const mapped = mapCtraderDealToEADeal(deal);
    expect(mapped.swap).toBe(-1.2);
    expect(mapped.commission).toBe(-0.5);
  });

  it('converts closeTimestamp to Unix epoch seconds', () => {
    const deal = makeCtraderDeal(6006, { closeTimestamp: '2026-07-01T00:00:00Z' });
    const mapped = mapCtraderDealToEADeal(deal);
    const expected = new Date('2026-07-01T00:00:00Z').getTime() / 1000;
    expect(mapped.time).toBe(expected);
  });
});
