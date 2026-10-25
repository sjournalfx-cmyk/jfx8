/**
 * Feature flags.
 *
 * DESKTOP_BRIDGE_ENABLED temporarily hides every entry point that can start a
 * Desktop Bridge (MT4/MT5 via EA) connection. Bridge code, routes and data
 * handling stay in place so existing bridge portfolios keep working. Flip this
 * to true to re-enable the entry points.
 */
export const DESKTOP_BRIDGE_ENABLED = false;
