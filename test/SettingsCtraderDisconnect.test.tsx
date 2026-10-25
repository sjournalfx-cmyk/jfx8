import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import Settings from '../components/Settings';

vi.mock('../lib/supabase', () => ({ supabase: {} }));
import type { Portfolio } from '../types';
import { createMockUserProfile } from './testUtils';

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

const renderSettings = (onDisconnectCtrader = vi.fn(async () => {})) => render(
  <Settings
    isDarkMode
    userProfile={createMockUserProfile()}
    onUpdateProfile={vi.fn(async () => {})}
    onLogout={vi.fn()}
    initialTab="account"
    portfolios={[portfolio]}
    activePortfolioId="p1"
    defaultPortfolioId="p1"
    hasCtraderConnection
    onDisconnectCtrader={onDisconnectCtrader}
  />,
);

describe('Settings cTrader disconnect', () => {
  it('confirms before disconnecting cTrader', async () => {
    const onDisconnectCtrader = vi.fn(async () => {});
    renderSettings(onDisconnectCtrader);

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect cTrader' }));
    expect(screen.getByText('Disconnect cTrader?')).toBeInTheDocument();
    expect(onDisconnectCtrader).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(onDisconnectCtrader).toHaveBeenCalledTimes(1));
  }, 15_000);
});
