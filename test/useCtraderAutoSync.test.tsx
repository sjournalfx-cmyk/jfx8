import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { CTRADER_AUTOSYNC_KEY, useCtraderAutoSync } from '../hooks/useCtraderAutoSync';
import { dataService } from '../services/dataService';
import { hasActiveSession, getAccounts, getClosedDeals, getSymbolsList, buildDigitsMap } from '../services/ctraderService';
import { persistentGetSync, persistentSet } from '../lib/persistentStore';
import type { Portfolio } from '../types';

vi.mock('../services/ctraderService', () => ({
  hasActiveSession: vi.fn(() => true),
  getAccounts: vi.fn(),
  getClosedDeals: vi.fn(),
  getSymbolsList: vi.fn(),
  buildDigitsMap: vi.fn(() => new Map()),
}));

vi.mock('../services/dataService', () => ({
  dataService: {
    batchAddTrades: vi.fn(),
  },
}));

vi.mock('../lib/persistentStore', () => ({
  persistentGetSync: vi.fn(() => null),
  persistentSet: vi.fn(),
}));

const portfolio: Portfolio = {
  id: 'p1',
  name: 'cTrader Portfolio',
  description: '',
  purpose: 'Journal',
  source: 'ctrader',
  isDefault: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  accounts: [{ provider: 'ctrader', externalAccountId: '123' }],
};

describe('useCtraderAutoSync', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(hasActiveSession).mockReturnValue(true);
    vi.mocked(getAccounts).mockResolvedValue([{ ctidTraderAccountId: 123, isDemo: false } as any]);
    vi.mocked(getSymbolsList).mockResolvedValue([{ symbolId: 1, symbolName: 'EURUSD' }]);
    vi.mocked(buildDigitsMap).mockReturnValue(new Map());
    vi.mocked(getClosedDeals).mockResolvedValue([{
      dealId: 9001,
      orderId: 7001,
      symbol: 'EURUSD',
      symbolId: 1,
      tradeSide: 'buy',
      volume: 0.1,
      price: 1.105,
      entryPrice: 1.1,
      profit: 10,
      swap: 0,
      commission: 0,
      openTimestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      closeTimestamp: new Date().toISOString(),
    }]);
    vi.mocked(persistentGetSync).mockReturnValue(null);
    vi.mocked(dataService.batchAddTrades).mockResolvedValue([{
      id: 'trade-1',
      portfolio_id: 'p1',
      ticketId: '9001',
    } as any]);
  });

  it('imports new closes for a linked portfolio while mounted in App', async () => {
    const onTradesAddedBatch = vi.fn();
    const onSynced = vi.fn();

    renderHook(() => useCtraderAutoSync({
      userId: 'user-1',
      enabled: true,
      portfolios: [portfolio],
      trades: [],
      onTradesAddedBatch,
      onSynced,
    }));

    await waitFor(() => {
      expect(dataService.batchAddTrades).toHaveBeenCalledTimes(1);
    });

    const built = vi.mocked(dataService.batchAddTrades).mock.calls[0][0];
    expect(built).toHaveLength(1);
    expect(built[0]).toMatchObject({
      pair: 'EURUSD',
      portfolio_id: 'p1',
      ticketId: '9001',
      pnl: 10,
    });
    expect(onTradesAddedBatch).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'trade-1', portfolio_id: 'p1' }),
    ]);
    expect(onSynced).toHaveBeenCalledWith(1, 'cTrader Portfolio');
    expect(persistentSet).toHaveBeenCalledWith(
      'jfx_ctrader_autosync_at_123_p1',
      expect.any(String),
    );
    expect(persistentSet).toHaveBeenCalledWith(
      'jfx_ctrader_saved_deals_123_p1',
      expect.stringContaining('9001'),
    );
  });

  it('does not fetch when the user turned auto-sync off', async () => {
    localStorage.setItem(CTRADER_AUTOSYNC_KEY, 'off');

    renderHook(() => useCtraderAutoSync({
      userId: 'user-1',
      enabled: true,
      portfolios: [portfolio],
      trades: [],
    }));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getAccounts).not.toHaveBeenCalled();
    expect(dataService.batchAddTrades).not.toHaveBeenCalled();
  });
});
