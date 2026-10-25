import { beforeEach, describe, expect, it } from 'vitest';
import { clearCachedCtraderBalance, readCachedCtraderBalance } from '../hooks/useCtraderLiveBalance';

describe('cached cTrader balance', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('removes the cached snapshot on disconnect', () => {
    localStorage.setItem('jfx_ctrader_last_balance_123', JSON.stringify({
      v: 1,
      balance: 12_345,
      equity: 12_500,
      capturedAt: new Date().toISOString(),
    }));

    expect(readCachedCtraderBalance(123)?.balance).toBe(12_345);
    clearCachedCtraderBalance(123);
    expect(readCachedCtraderBalance(123)).toBeNull();
  });

  it('ignores empty account ids', () => {
    clearCachedCtraderBalance(null);
    clearCachedCtraderBalance('');
    expect(localStorage.length).toBe(0);
  });
});
