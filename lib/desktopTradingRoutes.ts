/**
 * Desktop-only live-trading routes. Mobile keeps its existing shell and
 * bottom navigation; these ids only exist in the desktop sidebar/router.
 */

export type DesktopTradingRoute = 'trade' | 'quotes' | 'live-chart' | 'trading-locks';

export const DESKTOP_TRADING_ROUTES: readonly DesktopTradingRoute[] = [
  'trade',
  'quotes',
  'live-chart',
  'trading-locks',
];

export interface DesktopTradingNavItem {
  id: DesktopTradingRoute;
  label: string;
  description: string;
  requiresAccount: boolean;
}

/**
 * When no cTrader account is connected we keep a single entry so the page can
 * show a Connect CTA, rather than four dead panels.
 */
export const desktopTradingNavItems = (hasCtraderAccount: boolean): DesktopTradingNavItem[] => {
  if (!hasCtraderAccount) {
    return [
      {
        id: 'trade',
        label: 'Live Trading',
        description: 'Connect cTrader to trade live',
        requiresAccount: false,
      },
    ];
  }
  return [
    { id: 'trade', label: 'Live Trading', description: 'Market orders with SL/TP and open positions', requiresAccount: true },
    { id: 'quotes', label: 'Quotes', description: 'Live watchlist and quote actions', requiresAccount: true },
    { id: 'live-chart', label: 'Live Chart', description: 'cTrader chart with quick trade', requiresAccount: true },
    { id: 'trading-locks', label: 'Trading Locks', description: 'Hard limits for this portfolio', requiresAccount: true },
  ];
};

export const isDesktopTradingRoute = (view: string): view is DesktopTradingRoute =>
  (DESKTOP_TRADING_ROUTES as readonly string[]).includes(view);
