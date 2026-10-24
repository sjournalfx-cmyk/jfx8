import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import Dashboard from './Dashboard';
import { UserProfile } from '../types';

vi.mock('../hooks/useCtraderSymbols', () => ({
  useCtraderSymbols: () => ({
    symbols: [],
    isLoading: false,
    isDemo: false,
    error: null,
    reload: vi.fn(),
  }),
}));

vi.mock('./ui/SortableWidget', () => ({
  SortableWidget: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('./ui/Tooltip', () => ({
  Tooltip: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('./SessionClock', () => ({ default: () => <div>SessionClock</div> }));
vi.mock('./DailyQuote', () => ({ default: () => <div>DailyQuote</div> }));
vi.mock('./OpenPositions', () => ({ default: () => <div>OpenPositions</div> }));
vi.mock('./analytics/EquityCurveWidget', () => ({
  EquityCurveWidget: () => <div>EquityCurveWidget</div>,
}));
vi.mock('./desktop/CtraderAccountPanel', () => ({
  CtraderAccountPanel: () => <div>CtraderAccountPanel</div>,
}));

vi.mock('../lib/economicCalendarClient', () => ({
  fetchEconomicCalendar: vi.fn(async () => []),
  getCalendarWindow: () => ({
    from: '2026-01-01',
    to: '2026-01-31',
    today: '2026-01-15',
  }),
}));

vi.mock('../services/dataService', () => ({ dataService: {} }));
vi.mock('../lib/supabase', () => ({ supabase: {} }));

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: any) => <div>{children}</div>,
  closestCenter: {},
  KeyboardSensor: vi.fn(),
  PointerSensor: vi.fn(),
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn(() => []),
}));

vi.mock('@dnd-kit/sortable', () => ({
  arrayMove: vi.fn(),
  SortableContext: ({ children }: any) => <div>{children}</div>,
  sortableKeyboardCoordinates: {},
  rectSortingStrategy: {},
}));

const userProfile = {
  name: 'Test User',
  country: 'US',
  accountName: 'Test Account',
  initialBalance: 1000,
  currency: 'USD',
  currencySymbol: '$',
  syncMethod: 'Manual',
  experienceLevel: 'Intermediate',
  tradingStyle: 'Scalper',
  onboarded: true,
  plan: 'FREE TIER (JOURNALER)',
  syncKey: '',
  eaConnected: false,
  avatarUrl: '',
  themePreference: 'obsidian',
  chartConfig: {},
  keepChartsAlive: false,
} as UserProfile;

const baseProps = {
  isDarkMode: true,
  trades: [],
  dailyBias: [],
  onUpdateBias: vi.fn(),
  userProfile,
  onViewChange: vi.fn(),
  isDemoMode: false,
};

describe('Dashboard hooks order', () => {
  it('keeps the same hook order when loading finishes after login', () => {
    const { rerender } = render(<Dashboard {...baseProps} isLoading />);

    expect(() =>
      rerender(<Dashboard {...baseProps} isLoading={false} />)
    ).not.toThrow();
  });
});
