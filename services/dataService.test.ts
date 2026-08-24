import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dataService } from './dataService';
import { supabase } from '../lib/supabase';
import { Trade } from '../types';

// Mock Supabase with improved chaining
const createMockQueryBuilder = (mockData: any = null, mockError: any = null) => {
  const queryBuilder: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    single: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockReturnThis(),
    // Make it thenable to simulate a Promise
    then: (resolve: any) => resolve({ data: mockData, error: mockError }),
  };
  return queryBuilder;
};

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn(),
    },
    from: vi.fn(() => createMockQueryBuilder()),
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn().mockResolvedValue({ data: { path: 'test-path' } }),
        getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'http://test.com' } })),
        remove: vi.fn().mockResolvedValue({}),
      })),
    },
  },
}));

describe('dataService - Trade CRUD', () => {
  const mockUser = { id: 'user-123' };
  const mockTrade: Trade = {
    id: 'trade-1',
    ticketId: '12345',
    pair: 'EURUSD',
    assetType: 'Forex',
    date: '2023-01-01',
    time: '10:00',
    session: 'morning',
    direction: 'Long',
    entryPrice: 1.05,
    exitPrice: 1.06,
    stopLoss: 1.04,
    takeProfit: 1.07,
    lots: 0.1,
    result: 'Win',
    pnl: 10,
    commissions: undefined,
    fees: undefined,
    swap: undefined,
    rr: 2,
    rating: 5,
    tags: ['scalping'],
    notes: 'Good trade',
    emotions: ['calm'],
    planAdherence: 'Followed Exactly',
    tradingMistake: 'None',
    mindset: 'disciplined',
    exitComment: 'Hit TP',
    voiceNote: undefined,
    openTime: '10:00',
    closeTime: '11:00',
    beforeScreenshot: undefined,
    afterScreenshot: undefined,
    setupId: undefined,
    setupName: undefined,
    deletedAt: undefined,
  };

  const mockDbTrade = {
    id: 'trade-1',
    ticket_id: '12345',
    pair: 'EURUSD',
    asset_type: 'Forex',
    date: '2023-01-01',
    time: '10:00',
    session: 'morning',
    direction: 'Long',
    entry_price: 1.05,
    exit_price: 1.06,
    stop_loss: 1.04,
    take_profit: 1.07,
    lots: 0.1,
    result: 'Win',
    pnl: 10,
    rr: 2,
    rating: 5,
    tags: ['scalping'],
    notes: 'Good trade',
    emotions: ['calm'],
    plan_adherence: 'Followed Exactly',
    trading_mistake: 'None',
    mindset: 'disciplined',
    exit_comment: 'Hit TP',
    voice_note: undefined,
    open_time: '10:00',
    close_time: '11:00',
    before_screenshot: null,
    after_screenshot: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the from() queue entirely: leftover mockReturnValueOnce builders
    // from an earlier test would otherwise be consumed by the next one.
    (supabase.from as any).mockReset();
    (supabase.from as any).mockImplementation(() => createMockQueryBuilder());
    (supabase.auth.getUser as any).mockResolvedValue({ data: { user: mockUser } });
  });

  describe('getTrades', () => {
    it('should return mapped trades', async () => {
      (supabase.from as any).mockReturnValue(createMockQueryBuilder([mockDbTrade]));

      const result = await dataService.getTrades(mockUser.id);
      expect(result).toEqual([mockTrade]);
      expect(supabase.from).toHaveBeenCalledWith('trades');
    });

    it('should throw error on failure', async () => {
      (supabase.from as any).mockReturnValue(createMockQueryBuilder(null, new Error('DB error')));

      await expect(dataService.getTrades(mockUser.id)).rejects.toThrow('DB error');
    });
  });

  describe('addTrade', () => {
    it('should add trade successfully', async () => {
      const newTrade = { ...mockTrade, id: undefined };
      (supabase.from as any).mockReturnValue(createMockQueryBuilder(mockDbTrade));

      const result = await dataService.addTrade(newTrade as Trade);
      expect(result).toEqual(mockTrade);
      expect(supabase.from).toHaveBeenCalledWith('trades');
    });

    it('should throw error if not authenticated', async () => {
      (supabase.auth.getUser as any).mockResolvedValue({ data: { user: null } });

      await expect(dataService.addTrade(mockTrade)).rejects.toThrow('User not authenticated');
    });
  });

  describe('updateTrade', () => {
    it('should update trade successfully', async () => {
      // First call for select().single(), second for update().eq(), third for refresh select().single()
      (supabase.from as any)
        .mockReturnValueOnce(createMockQueryBuilder({ before_screenshot: null, after_screenshot: null }))
        .mockReturnValueOnce(createMockQueryBuilder({}))
        .mockReturnValueOnce(createMockQueryBuilder(mockDbTrade));

      await expect(dataService.updateTrade(mockTrade)).resolves.not.toThrow();
    });

    it('should clear screenshot columns when the trade explicitly removes them', async () => {
      const selectBuilder = createMockQueryBuilder({
        ...mockDbTrade,
        before_screenshot: 'https://old-before.png',
        after_screenshot: 'https://old-after.png',
      });
      const updateBuilder = createMockQueryBuilder({});

      (supabase.from as any)
        .mockReturnValueOnce(selectBuilder)
        .mockReturnValueOnce(updateBuilder)
        .mockReturnValueOnce(createMockQueryBuilder({
          ...mockDbTrade,
          before_screenshot: null,
          after_screenshot: null,
        }));

      const clearedTrade: Trade = {
        ...mockTrade,
        beforeScreenshot: undefined,
        afterScreenshot: undefined,
      };

      await expect(dataService.updateTrade(clearedTrade)).resolves.not.toThrow();

      expect(updateBuilder.update).toHaveBeenCalledWith(expect.objectContaining({
        before_screenshot: null,
        after_screenshot: null,
      }));
    });
  });

  describe('deleteTrades', () => {
    it('should delete trades successfully', async () => {
      (supabase.from as any).mockReturnValue(createMockQueryBuilder({}));

      await expect(dataService.deleteTrades(['trade-1'])).resolves.not.toThrow();
    });
  });

  describe('deleteNote', () => {
    it('should delete note successfully', async () => {
      (supabase.from as any).mockReturnValue(createMockQueryBuilder({}));

      await expect(dataService.deleteNote('note-1')).resolves.not.toThrow();
      expect(supabase.from).toHaveBeenCalledWith('notes');
    });

    it('should throw error on failure', async () => {
      (supabase.from as any).mockReturnValue(createMockQueryBuilder(null, new Error('Delete failed')));

      await expect(dataService.deleteNote('note-1')).rejects.toThrow('Delete failed');
    });
  });
});
