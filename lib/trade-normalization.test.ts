import { describe, expect, it } from 'vitest';
import { normalizeTrade } from './trade-normalization';

describe('normalizeTrade', () => {
  it('recalculates manual trade pnl and result from edited prices', () => {
    const normalized = normalizeTrade({
      id: '1',
      pair: 'eurusd',
      assetType: 'Forex',
      date: '2026-04-21',
      time: '10:00',
      direction: 'Long',
      entryPrice: 1.1,
      exitPrice: 1.101,
      stopLoss: 1.099,
      takeProfit: 1.102,
      lots: 1,
      result: 'Pending',
      pnl: 0,
      rating: 0,
      tags: [],
    }, {}, { preserveProvidedPnl: false });

    expect(normalized.pair).toBe('EURUSD');
    expect(normalized.session).toBe('London Session');
    expect(normalized.result).toBe('Win');
    expect(normalized.pnl).toBeCloseTo(100, 5);
  });

  it('preserves synced pnl when explicit backend values are provided', () => {
    const normalized = normalizeTrade({
      id: '2',
      pair: 'XAUUSD',
      assetType: 'Commodities',
      date: '2026-04-21',
      time: '19:00',
      direction: 'Short',
      entryPrice: 3300,
      exitPrice: 3299,
      stopLoss: 3301,
      takeProfit: 3295,
      lots: 1,
      result: 'BE',
      pnl: -7.5,
      commissions: -4,
      swap: -3.5,
      rating: 0,
      tags: ['MT5_Auto_Journal'],
    });

    expect(normalized.session).toBe('New York Session');
    expect(normalized.pnl).toBe(-7.5);
    expect(normalized.result).toBe('BE');
  });

  it('corrects and syncs pnl sign based on outcome', () => {
    // A trade with positive PNL but a result of Loss should have its PNL corrected to negative
    const normalizedLoss = normalizeTrade({
      id: '3',
      pair: 'EURUSD',
      assetType: 'Forex',
      date: '2026-04-21',
      time: '10:00',
      direction: 'Long',
      entryPrice: 1.1,
      exitPrice: 1.101,
      lots: 1,
      result: 'Loss',
      pnl: 100,
    });
    expect(normalizedLoss.result).toBe('Loss');
    expect(normalizedLoss.pnl).toBe(-100);

    // A trade with negative PNL but a result of Win should have its PNL corrected to positive
    const normalizedWin = normalizeTrade({
      id: '4',
      pair: 'EURUSD',
      assetType: 'Forex',
      date: '2026-04-21',
      time: '10:00',
      direction: 'Long',
      entryPrice: 1.1,
      exitPrice: 1.099,
      lots: 1,
      result: 'Win',
      pnl: -100,
    });
    expect(normalizedWin.result).toBe('Win');
    expect(normalizedWin.pnl).toBe(100);
  });
});
