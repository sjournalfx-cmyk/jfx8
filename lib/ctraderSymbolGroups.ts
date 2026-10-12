export type CtraderSymbolGroup = 'Forex' | 'Crypto' | 'Indices' | 'Commodities';

export const SYMBOL_GROUP_ORDER: CtraderSymbolGroup[] = ['Forex', 'Crypto', 'Indices', 'Commodities'];

const CRYPTO_TOKENS = [
  'BTC', 'ETH', 'XRP', 'LTC', 'BCH', 'ADA', 'DOT', 'SOL', 'DOGE', 'AVAX',
  'LINK', 'MATIC', 'POL', 'XLM', 'ATOM', 'NEAR', 'APT', 'ARB', 'OP', 'INJ',
  'TON', 'TRX', 'ETC', 'FIL', 'AAVE', 'UNI', 'ATOM', 'SUI', 'PEPE', 'SHIB',
  'USDT', 'USDC', 'DAI',
];

const INDEX_TOKENS = [
  'US30', 'NAS100', 'US100', 'SPX500', 'SP500', 'US500', 'GER40', 'DE40', 'DAX',
  'UK100', 'FTSE', 'JPN225', 'NIKKEI', 'JP225', 'AUS200', 'AU200', 'FRA40',
  'CAC40', 'ESP35', 'ES35', 'STOXX', 'EU50', 'HSI', 'HK50', 'VIX', 'VOLATILITY',
  'BOOM', 'CRASH', 'JUMP', 'STEP', 'RANGE', '1HZ', 'HFVOL', 'HFBULL', 'HFBEAR',
];

const COMMODITY_TOKENS = [
  'XAU', 'XAG', 'GOLD', 'SILVER', 'WTI', 'BRENT', 'OIL', 'USOIL', 'UKOIL',
  'NGAS', 'NATGAS', 'COPPER', 'XCU', 'PLATINUM', 'XPT', 'PALLADIUM', 'XPD',
  'WHEAT', 'CORN', 'COFFEE', 'SUGAR', 'COCOA', 'COTTON',
];

const containsToken = (name: string, tokens: string[]): boolean =>
  tokens.some((t) => name.includes(t));

/** Heuristic grouping so the Quotes picker can offer MT5-style categories. */
export const groupCtraderSymbol = (symbolName: string): CtraderSymbolGroup => {
  const name = (symbolName || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!name) return 'Forex';
  if (containsToken(name, CRYPTO_TOKENS)) return 'Crypto';
  if (containsToken(name, COMMODITY_TOKENS)) return 'Commodities';
  if (containsToken(name, INDEX_TOKENS)) return 'Indices';
  return 'Forex';
};
