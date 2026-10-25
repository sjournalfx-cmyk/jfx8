import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import EASetup from '../components/EASetup';
import { createMockUserProfile } from './testUtils';

vi.mock('../lib/supabase', () => ({ supabase: {} }));

vi.mock('../services/ctraderService', () => ({
  hasActiveSession: vi.fn(),
  isAuthenticated: vi.fn(),
  refreshToken: vi.fn(),
  getCtidProfile: vi.fn(),
  clearStaleCtraderFlags: vi.fn(),
  getAccounts: vi.fn(),
  getTrader: vi.fn(),
  getSelectedAccountId: vi.fn(),
  getAuthorizeUrl: vi.fn(() => 'https://example.test/oauth'),
  logout: vi.fn(),
}));

import {
  hasActiveSession,
  isAuthenticated,
  refreshToken,
  getCtidProfile,
  clearStaleCtraderFlags,
  getAccounts,
} from '../services/ctraderService';

const renderEASetup = (onCtraderDisconnect = vi.fn(async () => {})) => render(
  <EASetup
    isDarkMode
    userProfile={createMockUserProfile()}
    onUpdateProfile={vi.fn(async () => {})}
    trades={[]}
    userId="user-1"
    onCtraderDisconnect={onCtraderDisconnect}
  />,
);

describe('EASetup cTrader flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    vi.mocked(getCtidProfile).mockResolvedValue(null);
    vi.mocked(getAccounts).mockResolvedValue([]);
  });

  it('renders the cTrader connect view directly without dead bridge or paste-code UI', async () => {
    vi.mocked(hasActiveSession).mockReturnValue(false);
    vi.mocked(isAuthenticated).mockReturnValue(false);
    vi.mocked(refreshToken).mockResolvedValue(false);

    renderEASetup();

    expect(await screen.findByText(/cTrader session has expired/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect cTrader' })).toBeInTheDocument();
    expect(screen.queryByText('Desktop Bridge')).not.toBeInTheDocument();
    expect(screen.queryByText('Import CSV')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /back to methods/i })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Paste code/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Only view permissions/i)).not.toBeInTheDocument();
  });

  it('shows an account-fetch failure with a disconnect action instead of success', async () => {
    vi.mocked(hasActiveSession).mockReturnValue(true);
    vi.mocked(isAuthenticated).mockReturnValue(true);
    vi.mocked(clearStaleCtraderFlags).mockReturnValue(undefined);
    vi.mocked(getAccounts).mockRejectedValue(new Error('network down'));
    const onCtraderDisconnect = vi.fn(async () => {});

    renderEASetup(onCtraderDisconnect);

    expect(await screen.findByText('Could not load accounts')).toBeInTheDocument();
    expect(screen.getByText('network down')).toBeInTheDocument();
    expect(screen.queryByText(/Successfully authenticated with cTrader/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(onCtraderDisconnect).toHaveBeenCalledTimes(1));
  }, 15_000);
});
