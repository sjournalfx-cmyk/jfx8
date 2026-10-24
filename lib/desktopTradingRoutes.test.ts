import { describe, expect, it } from 'vitest';
import {
  DESKTOP_TRADING_ROUTES,
  desktopTradingNavItems,
  isDesktopTradingRoute,
} from './desktopTradingRoutes';

describe('desktop trading routes', () => {
  it('recognises every live-trading view', () => {
    for (const route of DESKTOP_TRADING_ROUTES) {
      expect(isDesktopTradingRoute(route)).toBe(true);
    }
    expect(isDesktopTradingRoute('dashboard')).toBe(false);
  });

  it('collapses to a single connect entry when no account is linked', () => {
    const items = desktopTradingNavItems(false);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'trade', requiresAccount: false });
  });

  it('exposes all four surfaces when connected', () => {
    expect(desktopTradingNavItems(true).map((item) => item.id)).toEqual([
      'trade',
      'quotes',
      'live-chart',
      'trading-locks',
    ]);
  });
});
