import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { NoConnectionState } from '../components/log-trade/NoConnectionState';
import LogTrade from '../components/LogTrade';
import { BROKER_PARTNERS, PROP_FIRM_PARTNERS } from '../config/partnerLinks';
import type { UserProfile } from '../types';

vi.mock('../services/ctraderService', () => ({
  hasActiveSession: vi.fn(() => false),
}));

import { hasActiveSession } from '../services/ctraderService';

const createProfile = (overrides: Partial<UserProfile> = {}): UserProfile => ({
  name: 'Test User',
  country: 'US',
  accountName: 'Test Account',
  initialBalance: 10000,
  currency: 'USD',
  currencySymbol: '$',
  syncMethod: 'Manual',
  experienceLevel: 'Intermediate',
  tradingStyle: 'Day Trader',
  onboarded: true,
  plan: 'free',
  themePreference: 'obsidian',
  eaConnected: false,
  ...overrides,
});

const baseLogTradeProps = {
  isDarkMode: true,
  onSave: vi.fn(async () => {}),
  currencySymbol: '$',
  trades: [],
  onConnectBroker: vi.fn(),
};

describe('NoConnectionState', () => {
  it('renders the heading and all three cards with OR between the last two', () => {
    render(<NoConnectionState onConnect={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Ready for the next step?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pick a broker/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pick a prop firm/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /connect broker \/ prop/i })).toBeInTheDocument();
    expect(screen.getByText('OR')).toBeInTheDocument();
  });

  it('lists brokers as safe external links', () => {
    render(<NoConnectionState onConnect={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /pick a broker/i }));

    const dialog = screen.getByRole('dialog', { name: 'Pick a broker' });
    for (const partner of BROKER_PARTNERS) {
      const link = within(dialog).getByRole('link', { name: partner.name });
      expect(link).toHaveAttribute('href', partner.url);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
    expect(
      within(dialog).getByText('cTrader and MT5 brokers sync through the JFX desktop connection.'),
    ).toBeInTheDocument();
  });

  it('lists prop firms as safe external links', () => {
    render(<NoConnectionState onConnect={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /pick a prop firm/i }));

    const dialog = screen.getByRole('dialog', { name: 'Pick a prop firm' });
    for (const partner of PROP_FIRM_PARTNERS) {
      const link = within(dialog).getByRole('link', { name: partner.name });
      expect(link).toHaveAttribute('href', partner.url);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  it('opens the existing connect flow from the third card', () => {
    const onConnect = vi.fn();
    render(<NoConnectionState onConnect={onConnect} />);

    fireEvent.click(screen.getByRole('button', { name: /connect broker \/ prop/i }));

    expect(onConnect).toHaveBeenCalledTimes(1);
  });
});

describe('LogTrade connection gate', () => {
  beforeEach(() => {
    vi.mocked(hasActiveSession).mockReturnValue(false);
    window.localStorage.clear();
  });

  it('renders the empty state instead of the form when nothing is connected', () => {
    render(<LogTrade {...baseLogTradeProps} userProfile={createProfile()} />);

    expect(screen.getByTestId('no-connection-state')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ready for the next step?' })).toBeInTheDocument();
    expect(screen.queryByText('Log Trade')).not.toBeInTheDocument();
  });

  it('renders the form when a desktop bridge is connected', () => {
    render(
      <LogTrade
        {...baseLogTradeProps}
        userProfile={createProfile({ eaConnected: true })}
      />,
    );

    expect(screen.queryByTestId('no-connection-state')).not.toBeInTheDocument();
    expect(screen.getByText('Log Trade')).toBeInTheDocument();
  });

  it('renders the form when a cTrader account is connected', () => {
    render(
      <LogTrade
        {...baseLogTradeProps}
        userProfile={createProfile()}
        ctraderAccountId="123456"
      />,
    );

    expect(screen.queryByTestId('no-connection-state')).not.toBeInTheDocument();
    expect(screen.getByText('Log Trade')).toBeInTheDocument();
  });

  it('keeps the form for edits even when disconnected', () => {
    render(
      <LogTrade
        {...baseLogTradeProps}
        userProfile={createProfile()}
        initialTrade={{
          id: 'trade-1',
          pair: 'EURUSD',
          assetType: 'Forex',
          date: '2026-02-19',
          time: '10:30:00',
          session: 'London',
          direction: 'Long',
          entryPrice: 1.085,
          stopLoss: 1.082,
          takeProfit: 1.09,
          lots: 0.1,
          result: 'Pending',
          pnl: 0,
          rr: 0,
          rating: 0,
          tags: [],
        }}
      />,
    );

    expect(screen.queryByTestId('no-connection-state')).not.toBeInTheDocument();
    expect(screen.getByText('Edit Trade')).toBeInTheDocument();
  });
});
