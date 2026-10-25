import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PortfolioSwitcher } from '../components/PortfolioSwitcher';
import LogTrade from '../components/LogTrade';
import { DESKTOP_BRIDGE_ENABLED } from '../config/features';
import { viewAfterPortfolioCreate } from '../lib/portfolioCreation';
import type { Portfolio, UserProfile } from '../types';

vi.mock('../services/ctraderService', () => ({
  hasActiveSession: vi.fn(() => false),
}));

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

const defaultPortfolio: Portfolio = {
  id: 'default',
  name: 'Default Portfolio',
  description: 'Main Trading Journal',
  purpose: 'Journal',
  source: 'manual',
  isDefault: true,
  createdAt: '2020-01-01T00:00:00.000Z',
};

const renderSwitcher = (onAdd: (input: {
  name: string;
  description?: string;
  purpose?: Portfolio['purpose'];
  source?: Portfolio['source'];
  startingBalance?: number;
  currency?: string;
}) => Promise<Portfolio>) => render(
  <PortfolioSwitcher
    portfolios={[defaultPortfolio]}
    activeId={defaultPortfolio.id}
    defaultId={defaultPortfolio.id}
    canAdd
    onSelect={vi.fn()}
    onAdd={onAdd}
    onRemove={vi.fn(async () => {})}
  />,
);

type AddPortfolio = React.ComponentProps<typeof PortfolioSwitcher>['onAdd'];

const CreateFlowHarness: React.FC<{ onAdd: AddPortfolio }> = ({ onAdd }) => {
  const [view, setView] = React.useState<'portfolios' | 'log-trade' | 'ea-setup'>('portfolios');

  const handleAdd: AddPortfolio = async (input) => {
    const created = await onAdd(input);
    const nextView = viewAfterPortfolioCreate(created.source || 'manual');
    if (nextView) setView(nextView);
    return created;
  };

  if (view === 'log-trade') {
    return (
      <LogTrade
        isDarkMode
        onSave={vi.fn(async () => {})}
        currencySymbol="$"
        trades={[]}
        userProfile={createProfile()}
        onConnectBroker={vi.fn()}
      />
    );
  }

  if (view === 'ea-setup') return <div>connector</div>;

  return (
    <PortfolioSwitcher
      portfolios={[defaultPortfolio]}
      activeId={defaultPortfolio.id}
      defaultId={defaultPortfolio.id}
      canAdd
      onSelect={vi.fn()}
      onAdd={handleAdd}
      onRemove={vi.fn(async () => {})}
    />
  );
};

const openCreateForm = () => {
  fireEvent.click(screen.getByRole('button', { name: /new portfolio/i }));
  fireEvent.change(screen.getByPlaceholderText('e.g. Funded 100K'), {
    target: { value: 'Prop Account' },
  });
};

describe('portfolio creation flow', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('creates a cTrader portfolio, routes to Log Trade and shows the empty state', async () => {
    const created: Portfolio = {
      ...defaultPortfolio,
      id: 'ctrader-1',
      name: 'Prop Account',
      source: 'ctrader',
      isDefault: false,
    };
    const onAdd = vi.fn(async () => created);

    render(<CreateFlowHarness onAdd={onAdd} />);
    openCreateForm();

    fireEvent.click(screen.getByRole('button', { name: /^cTrader/i }));
    expect(
      screen.getByText(
        "After creating, you'll pick a broker or connect your cTrader account. One account per portfolio.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /create portfolio/i }));

    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Prop Account',
        source: 'ctrader',
      }));
      expect(screen.getByTestId('no-connection-state')).toBeInTheDocument();
    });

    expect(screen.getByRole('heading', { name: 'Ready for the next step?' })).toBeInTheDocument();
  });

  it('keeps manual creation on the current page', async () => {
    const created: Portfolio = {
      ...defaultPortfolio,
      id: 'manual-1',
      name: 'Prop Account',
      isDefault: false,
    };
    const onAdd = vi.fn(async () => created);

    renderSwitcher(onAdd);
    openCreateForm();
    fireEvent.click(screen.getByRole('button', { name: /create portfolio/i }));

    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ source: 'manual' }));
    });
    expect(viewAfterPortfolioCreate(created.source)).toBeNull();
  });

  it('shows the Desktop Bridge option disabled and unselectable while the flag is false', async () => {
    expect(DESKTOP_BRIDGE_ENABLED).toBe(false);
    const created: Portfolio = {
      ...defaultPortfolio,
      id: 'manual-2',
      name: 'Prop Account',
      isDefault: false,
    };
    const onAdd = vi.fn(async () => created);

    renderSwitcher(onAdd);
    openCreateForm();

    const bridgeOption = screen.getByRole('button', { name: /desktop bridge/i });
    expect(bridgeOption).toBeDisabled();
    expect(bridgeOption).toHaveAttribute('aria-disabled', 'true');
    expect(bridgeOption.className).toContain('opacity-50');
    expect(screen.queryByText(/coming soon|disabled|soon/i)).not.toBeInTheDocument();

    fireEvent.click(bridgeOption);
    fireEvent.click(screen.getByRole('button', { name: /create portfolio/i }));

    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ source: 'manual' }));
    });
  });

  it('uses the shortened connect copy while the bridge is off', () => {
    render(
      <LogTrade
        isDarkMode
        onSave={vi.fn(async () => {})}
        currencySymbol="$"
        trades={[]}
        userProfile={createProfile()}
        onConnectBroker={vi.fn()}
      />,
    );

    expect(
      screen.getByText('Already have a Deriv or cTrader account? Connect it to log trades from here.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/or MT5 account/i)).not.toBeInTheDocument();
  });
});
