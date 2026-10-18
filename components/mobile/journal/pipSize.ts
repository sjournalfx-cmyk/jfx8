/**
 * Instrument-aware pip-size lookup used for display (e.g. Journal overview).
 * Falls back to standard forex (0.0001) for unrecognised symbols.
 * Verbatim from jfx-mobile lib/tradeDirectionRepair.ts so the web mobile
 * Journal shows the same pip values as the APK.
 */
export const getPipSize = (pair: string): number => {
  const upper = pair.toUpperCase().replace(/[^A-Z0-9]/g, '');

  // Indices (GER40, US30, US500, NAS100, UK100, JP225, EU50, etc.)
  // cTrader treats 1 pip = 0.1 index points for most indices.
  if (/^(GER|DE|DAX|US|NAS|UK|FTSE|JP|NIK|EU|SX|AUS|HK|FR|ES|IT|CH|SE|NL|SPX|DJI|NDX)\d/.test(upper) ||
      upper.includes('500') || upper.includes('100') || upper.includes('225') ||
      upper.endsWith('INDEX') || upper.endsWith('IDX')) {
    return 0.1;
  }

  // Gold
  if (upper.includes('XAUUSD') || upper.includes('GOLD')) return 0.01;
  // Silver
  if (upper.includes('XAGUSD') || upper.includes('SILVER')) return 0.001;
  // Oil (WTI, Brent, etc.)
  if (upper.includes('WTI') || upper.includes('BRENT') || upper.includes('USOIL') ||
      upper.includes('UKOIL') || upper.includes('CRUDE') || upper.includes('OIL')) return 0.01;
  // Crypto (BTCUSD, ETHUSD, etc.)
  if (upper.startsWith('BTC') || upper.startsWith('ETH') || upper.startsWith('XRP') ||
      upper.startsWith('SOL') || upper.startsWith('ADA') || upper.includes('CRYPTO')) return 1;
  // JPY pairs
  if (upper.includes('JPY')) return 0.01;
  // Standard forex
  return 0.0001;
};
