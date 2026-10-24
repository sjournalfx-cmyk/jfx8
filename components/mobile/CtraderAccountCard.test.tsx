import { describe, it, expect, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { CtraderAccountCard } from './CtraderAccountCard';

vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: null } })) } },
}));

vi.mock('../../hooks/useCtraderSpots', () => ({
  useCtraderSpots: () => ({}),
}));

vi.mock('../CtraderPositionRow', () => ({
  CtraderPositionRow: () => <div>CtraderPositionRow</div>,
}));

vi.mock('../../services/ctraderService', () => ({
  getAccounts: vi.fn(async () => []),
  getTrader: vi.fn(async () => null),
  getPositions: vi.fn(async () => []),
  getPendingOrders: vi.fn(async () => []),
  getClosedDeals: vi.fn(async () => []),
  addCtraderListener: vi.fn(() => () => {}),
  closePosition: vi.fn(async () => undefined),
  amendPositionSltp: vi.fn(async () => undefined),
  PT: { EXECUTION_EVENT: 1 },
}));

describe('CtraderAccountCard hooks order', () => {
  it('keeps the same hook order when an account becomes linked', async () => {
    const { rerender } = render(
      <CtraderAccountCard ctidAccountId={null} isDemo={false} />
    );

    expect(() =>
      rerender(<CtraderAccountCard ctidAccountId="123456" isDemo={false} />)
    ).not.toThrow();

    await act(async () => {
      await Promise.resolve();
    });
  });
});
