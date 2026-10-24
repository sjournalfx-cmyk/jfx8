/**
 * Which routes/views are mobile-allowed vs desktop-only.
 * Market grid (charts) is desktop-only per grill decision.
 */

export const MOBILE_ROUTES = new Set<string>([
  'dashboard',
  'home',
  'backtest-lab',
  'history',     // Journal
  'journal',
  'log-trade',
  'add-trade',
  'analytics',
  'time-metrics',
  'calendar',
  'notes',
  'ai-chat',
  'ea-setup',    // keep broker connect reachable; stub on mobile if desired later
  'discipline',  // Strategy Rules & Checklists (Discipline Engine)
  'portfolios',  // portfolio manager (drawer + desktop nav)
]);

// Desktop-only: never render on APK / small screens — show a desktop-only notice instead.
// Includes Market Grid (charts) + heavy labs.
export const DESKTOP_ONLY_ROUTES = new Set<string>([
  'charts',        // <-- Market Grid / ChartGrid
  'market-grid',   // alias if router ever uses this id
  'settings',
  // Desktop live-trading surfaces (mobile uses the Log Trade tabs instead).
  'trade',
  'quotes',
  'live-chart',
  'trading-locks',
]);

export const isMobileRoute = (view: string) => MOBILE_ROUTES.has(view);
export const isDesktopOnlyRoute = (view: string) => DESKTOP_ONLY_ROUTES.has(view);
