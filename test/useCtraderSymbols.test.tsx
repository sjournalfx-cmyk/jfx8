import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const service = vi.hoisted(() => ({
  getAccounts: vi.fn(),
  getCachedSymbolsList: vi.fn(),
}));

vi.mock('../services/ctraderService', () => service);

import { useCtraderSymbols } from '../hooks/useCtraderSymbols';

describe('useCtraderSymbols', () => {
  beforeEach(() => {
    service.getAccounts.mockReset();
    service.getCachedSymbolsList.mockReset();
    service.getAccounts.mockResolvedValue([{ ctidTraderAccountId: 1001, isDemo: true }]);
  });

  it('surfaces a symbol-load failure instead of showing an empty list', async () => {
    service.getCachedSymbolsList.mockRejectedValue(new Error('symbols unavailable'));
    const { result } = renderHook(() => useCtraderSymbols('1001'));

    await waitFor(() => expect(result.current.error).toBe('symbols unavailable'));
    expect(result.current.symbols).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('retries after reload and replaces the error with symbols', async () => {
    service.getCachedSymbolsList
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce([{ symbolId: 1, symbolName: 'EURUSD', digits: 5 }]);
    const { result } = renderHook(() => useCtraderSymbols('1001'));

    await waitFor(() => expect(result.current.error).toBe('network down'));

    act(() => result.current.reload());

    await waitFor(() => expect(result.current.symbols).toHaveLength(1));
    expect(result.current.error).toBeNull();
    expect(result.current.symbols[0].symbolName).toBe('EURUSD');
  });
});
