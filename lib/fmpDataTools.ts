type EarningsItem = {
  date?: string;
  symbol?: string;
  eps?: number | null;
  epsEstimated?: number | null;
  revenue?: number | null;
  revenueEstimated?: number | null;
  time?: string;
};

type TreasuryItem = {
  date?: string;
  maturity?: string;
  yield?: number | string;
};

type QuoteItem = {
  symbol?: string;
  price?: number;
  change?: number;
  changesPercentage?: number | string;
  dayLow?: number;
  dayHigh?: number;
  volume?: number;
  marketCap?: number;
  previousClose?: number;
};

type ProfileItem = {
  symbol?: string;
  companyName?: string;
  sector?: string;
  industry?: string;
  marketCap?: number;
  description?: string;
  website?: string;
  image?: string;
  exchangeShortName?: string;
};

type KeyMetricsItem = {
  symbol?: string;
  marketCap?: number;
  enterpriseValueTTM?: number;
  peRatioTTM?: number;
  priceToSalesRatioTTM?: number;
  priceToBookRatioTTM?: number;
  revenuePerShareTTM?: number;
  debtToEquityTTM?: number;
  returnOnEquityTTM?: number;
  returnOnAssetsTTM?: number;
  currentRatioTTM?: number;
  dividendYieldTTM?: number;
  earningsYieldTTM?: number;
  freeCashFlowYieldTTM?: number;
};

type StatementItem = {
  date?: string;
  reportedCurrency?: string;
  symbol?: string;
  revenue?: number;
  costOfRevenue?: number;
  grossProfit?: number;
  operatingExpenses?: number;
  netIncome?: number;
  operatingIncome?: number;
  totalAssets?: number;
  totalLiabilities?: number;
  totalShareholderEquity?: number;
  totalDebt?: number;
  cashAndCashEquivalents?: number;
  operatingCashFlow?: number;
  freeCashFlow?: number;
  capitalExpenditure?: number;
  dividendsPaid?: number;
  stockBasedCompensation?: number;
};

type RatiosItem = {
  symbol?: string;
  grossProfitMarginTTM?: number;
  ebitMarginTTM?: number;
  operatingProfitMarginTTM?: number;
  netProfitMarginTTM?: number;
  returnOnEquityTTM?: number;
  returnOnAssetsTTM?: number;
  debtToEquityTTM?: number;
  currentRatioTTM?: number;
  quickRatioTTM?: number;
  inventoryTurnoverTTM?: number;
  assetTurnoverTTM?: number;
  dividendYieldTTM?: number;
  payoutRatioTTM?: number;
  earningsYieldTTM?: number;
  freeCashFlowYieldTTM?: number;
};

type FinancialGrowthItem = {
  symbol?: string;
  date?: string;
  revenueGrowth?: number;
  netIncomeGrowth?: number;
  epsGrowth?: number;
  operatingCashFlowGrowth?: number;
  freeCashFlowGrowth?: number;
  dividendGrowth?: number;
  bookValueGrowth?: number;
  assetsGrowth?: number;
  debtGrowth?: number;
  rdexpenseGrowth?: number;
};

type PriceChangeItem = {
  symbol?: string;
  '1D'?: number;
  '5D'?: number;
  '1M'?: number;
  '3M'?: number;
  '6M'?: number;
  '1Y'?: number;
  '3Y'?: number;
  '5Y'?: number;
};

type DcfItem = {
  symbol?: string;
  date?: string;
  dcf?: number;
  'Stock Price'?: number;
};

const fmtPct = (v: number | undefined | null): string => {
  if (v === undefined || v === null) return 'N/A';
  return Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : 'N/A';
};

const fmtRatioPct = (v: number | undefined | null): string => {
  if (v === undefined || v === null) return 'N/A';
  return Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%` : 'N/A';
};

const fmtNum = (v: number | undefined | null): string => {
  if (v === undefined || v === null) return 'N/A';
  return Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'N/A';
};

const fmtLargeNum = (v: number | undefined | null): string => {
  if (v === undefined || v === null) return 'N/A';
  if (!Number.isFinite(v)) return 'N/A';
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  return fmtNum(v);
};

const firstItem = <T>(data: unknown): T | undefined =>
  (Array.isArray(data) ? data[0] : data) as T | undefined;

export const formatKeyMetricsMarkdown = (data: unknown): string => {
  const item = firstItem<KeyMetricsItem>(data);
  if (!item?.symbol) return '## Key Metrics\n\nNo metrics data available for that symbol.';

  const rows = [
    ['Market Cap', fmtLargeNum(item.marketCap)],
    ['Enterprise Value (TTM)', fmtLargeNum(item.enterpriseValueTTM)],
    ['P/E Ratio (TTM)', item.peRatioTTM != null ? item.peRatioTTM.toFixed(2) : 'N/A'],
    ['Price/Sales (TTM)', item.priceToSalesRatioTTM != null ? item.priceToSalesRatioTTM.toFixed(2) : 'N/A'],
    ['Price/Book (TTM)', item.priceToBookRatioTTM != null ? item.priceToBookRatioTTM.toFixed(2) : 'N/A'],
    ['Revenue/Share (TTM)', item.revenuePerShareTTM != null ? `$${item.revenuePerShareTTM.toFixed(2)}` : 'N/A'],
    ['Debt/Equity (TTM)', item.debtToEquityTTM != null ? item.debtToEquityTTM.toFixed(2) : 'N/A'],
    ['ROE (TTM)', fmtRatioPct(item.returnOnEquityTTM)],
    ['ROA (TTM)', fmtRatioPct(item.returnOnAssetsTTM)],
    ['Current Ratio (TTM)', item.currentRatioTTM != null ? item.currentRatioTTM.toFixed(2) : 'N/A'],
    ['Dividend Yield (TTM)', fmtRatioPct(item.dividendYieldTTM)],
    ['Free Cash Flow Yield (TTM)', fmtRatioPct(item.freeCashFlowYieldTTM)],
  ];

  const table = `| Metric | Value |\n|--------|-------|\n${rows.map(([k, v]) => `| **${k}** | ${v} |`).join('\n')}`;
  return `## ${item.symbol} — Key Metrics (TTM)\n\n${table}\n\n*Source: Financial Modeling Prep — free plan data*`;
};

export const formatStatementsMarkdown = (income: unknown, balance: unknown, cashFlow: unknown): string => {
  const inc = firstItem<StatementItem>(income);
  const bal = firstItem<StatementItem>(balance);
  const cf = firstItem<StatementItem>(cashFlow);

  if (!inc?.symbol) return '## Financial Statements\n\nNo statement data available for that symbol.';

  const symbol = inc.symbol;
  const period = inc.date || bal?.date || cf?.date || 'Latest';
  const currency = inc.reportedCurrency || 'USD';

  return [
    `## ${symbol} — Financial Statements (${period}, ${currency})`,
    '',
    '### Income Statement',
    '| Metric | Value |',
    '|--------|-------|',
    `| **Revenue** | ${fmtLargeNum(inc.revenue)} |`,
    `| **Cost of Revenue** | ${fmtLargeNum(inc.costOfRevenue)} |`,
    `| **Gross Profit** | ${fmtLargeNum(inc.grossProfit)} |`,
    `| **Operating Expenses** | ${fmtLargeNum(inc.operatingExpenses)} |`,
    `| **Operating Income** | ${fmtLargeNum(inc.operatingIncome)} |`,
    `| **Net Income** | ${fmtLargeNum(inc.netIncome)} |`,
    '',
    '### Balance Sheet',
    '| Metric | Value |',
    '|--------|-------|',
    `| **Total Assets** | ${fmtLargeNum(bal?.totalAssets)} |`,
    `| **Total Liabilities** | ${fmtLargeNum(bal?.totalLiabilities)} |`,
    `| **Shareholder Equity** | ${fmtLargeNum(bal?.totalShareholderEquity)} |`,
    `| **Total Debt** | ${fmtLargeNum(bal?.totalDebt)} |`,
    `| **Cash & Equivalents** | ${fmtLargeNum(bal?.cashAndCashEquivalents)} |`,
    '',
    '### Cash Flow',
    '| Metric | Value |',
    '|--------|-------|',
    `| **Operating Cash Flow** | ${fmtLargeNum(cf?.operatingCashFlow)} |`,
    `| **Free Cash Flow** | ${fmtLargeNum(cf?.freeCashFlow)} |`,
    `| **Capital Expenditure** | ${fmtLargeNum(cf?.capitalExpenditure)} |`,
    `| **Dividends Paid** | ${fmtLargeNum(cf?.dividendsPaid)} |`,
    '',
    '*Source: Financial Modeling Prep — free plan data*',
  ].join('\n');
};

export const formatRatiosMarkdown = (ratios: unknown, growth: unknown): string => {
  const r = firstItem<RatiosItem>(ratios);
  const g = firstItem<FinancialGrowthItem>(growth);

  if (!r?.symbol) return '## Ratios & Growth\n\nNo data available for that symbol.';

  const symbol = r.symbol;

  const ratioRows = [
    ['Gross Profit Margin', fmtRatioPct(r.grossProfitMarginTTM)],
    ['Operating Margin', fmtRatioPct(r.ebitMarginTTM)],
    ['Net Profit Margin', fmtRatioPct(r.netProfitMarginTTM)],
    ['ROE', fmtRatioPct(r.returnOnEquityTTM)],
    ['ROA', fmtRatioPct(r.returnOnAssetsTTM)],
    ['Debt/Equity', r.debtToEquityTTM != null ? r.debtToEquityTTM.toFixed(2) : 'N/A'],
    ['Current Ratio', r.currentRatioTTM != null ? r.currentRatioTTM.toFixed(2) : 'N/A'],
    ['Quick Ratio', r.quickRatioTTM != null ? r.quickRatioTTM.toFixed(2) : 'N/A'],
    ['Dividend Yield', fmtRatioPct(r.dividendYieldTTM)],
    ['Payout Ratio', fmtRatioPct(r.payoutRatioTTM)],
    ['FCF Yield', fmtRatioPct(r.freeCashFlowYieldTTM)],
  ];

  const growthRows = g ? [
    ['Revenue Growth', fmtRatioPct(g.revenueGrowth)],
    ['Net Income Growth', fmtRatioPct(g.netIncomeGrowth)],
    ['EPS Growth', fmtRatioPct(g.epsGrowth)],
    ['FCF Growth', fmtRatioPct(g.freeCashFlowGrowth)],
    ['Dividend Growth', fmtRatioPct(g.dividendGrowth)],
    ['Book Value Growth', fmtRatioPct(g.bookValueGrowth)],
    ['Asset Growth', fmtRatioPct(g.assetsGrowth)],
  ] : [];

  const ratioTable = `| Ratio | Value |\n|------|-------|\n${ratioRows.map(([k, v]) => `| **${k}** | ${v} |`).join('\n')}`;
  const growthTable = growthRows.length > 0
    ? `\n\n### Growth Rates\n| Metric | Value |\n|--------|-------|\n${growthRows.map(([k, v]) => `| **${k}** | ${v} |`).join('\n')}`
    : '';

  return `## ${symbol} — Ratios & Growth\n\n${ratioTable}${growthTable}\n\n*Source: Financial Modeling Prep — free plan data*`;
};

export const formatPriceChangeMarkdown = (data: unknown): string => {
  const item = firstItem<PriceChangeItem>(data);
  if (!item?.symbol) return '## Price Change\n\nNo price change data available for that symbol.';

  const periods = [
    ['1 Day', item['1D']],
    ['5 Days', item['5D']],
    ['1 Month', item['1M']],
    ['3 Months', item['3M']],
    ['6 Months', item['6M']],
    ['1 Year', item['1Y']],
    ['3 Years', item['3Y']],
    ['5 Years', item['5Y']],
  ].filter(([, v]) => v !== undefined && v !== null);

  const table = `| Period | Change |\n|--------|--------|\n${periods.map(([p, v]) => `| **${p}** | ${fmtPct(v as number)} |`).join('\n')}`;
  return `## ${item.symbol} — Price Change\n\n${table}\n\n*Source: Financial Modeling Prep — free plan data*`;
};

export const formatDcfMarkdown = (data: unknown): string => {
  const item = firstItem<DcfItem>(data);
  if (!item?.symbol) return '## DCF Valuation\n\nNo DCF data available for that symbol.';

  const dcfVal = item.dcf != null ? `$${item.dcf.toFixed(2)}` : 'N/A';
  const price = item['Stock Price'] != null ? `$${item['Stock Price'].toFixed(2)}` : 'N/A';
  const diff = item.dcf != null && item['Stock Price'] != null
    ? ((item['Stock Price'] - item.dcf) / item.dcf * 100).toFixed(1)
    : 'N/A';
  const verdict = item.dcf != null && item['Stock Price'] != null
    ? (item['Stock Price'] > item.dcf ? 'Overvalued' : 'Undervalued')
    : 'N/A';

  return [
    `## ${item.symbol} — DCF Valuation`,
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| **DCF Fair Value** | ${dcfVal} |`,
    `| **Current Price** | ${price} |`,
    `| **Difference** | ${diff !== 'N/A' ? `${diff}%` : 'N/A'} |`,
    `| **Verdict** | ${verdict} |`,
    '',
    '*Source: Financial Modeling Prep — free plan data*',
  ].join('\n');
};

export const formatEarningsCalendarMarkdown = (data: unknown): string => {
  const items = (Array.isArray(data) ? data : []) as EarningsItem[];
  if (items.length === 0) return '## Earnings Calendar\n\nNo upcoming earnings reports found.';

  const header = '| Date | Symbol | Est. EPS | Est. Revenue | Time |';
  const separator = '|------|--------|----------|-------------|------|';
  const rows = items.slice(0, 15).map((item) => {
    const eps = item.epsEstimated != null ? `$${item.epsEstimated.toFixed(2)}` : 'N/A';
    const rev = item.revenueEstimated != null ? `$${item.revenueEstimated.toLocaleString()}` : 'N/A';
    return `| ${item.date || 'TBD'} | ${item.symbol || 'N/A'} | ${eps} | ${rev} | ${item.time || 'N/A'} |`;
  });

  return `## Earnings Calendar\n\n${header}\n${separator}\n${rows.join('\n')}\n\n*Source: Financial Modeling Prep — free plan data*`;
};

export const formatTreasuryRatesMarkdown = (data: unknown): string => {
  const items = (Array.isArray(data) ? data : []) as TreasuryItem[];
  if (items.length === 0) return '## Treasury Rates\n\nNo treasury rate data available right now.';

  const header = '| Maturity | Yield | Date |';
  const separator = '|----------|-------|------|';
  const rows = items.map((item) => `| ${item.maturity || 'Unknown'} | ${item.yield != null ? `${item.yield}%` : 'N/A'} | ${item.date || 'N/A'} |`);

  return `## Treasury Rates (Yield Curve)\n\n${header}\n${separator}\n${rows.join('\n')}\n\n*Source: Financial Modeling Prep — free plan data*`;
};

export const formatQuoteMarkdown = (data: unknown): string => {
  const item = firstItem<QuoteItem>(data);
  if (!item?.symbol) return '## Stock Quote\n\nNo quote data available for that symbol.';

  const changeStr = fmtPct(item.changesPercentage);
  const direction = item.change && item.change >= 0 ? '▲' : '▼';

  return `## ${item.symbol} — Stock Quote\n\n| Metric | Value |\n|--------|-------|\n| **Price** | $${fmtNum(item.price)} |\n| **Change** | ${direction} $${fmtNum(item.change)} (${changeStr}) |\n| **Day Range** | $${fmtNum(item.dayLow)} – $${fmtNum(item.dayHigh)} |\n| **Volume** | ${item.volume?.toLocaleString() || 'N/A'} |\n| **Market Cap** | ${fmtLargeNum(item.marketCap)} |\n| **Previous Close** | $${fmtNum(item.previousClose)} |\n\n*Source: Financial Modeling Prep — free plan data (delayed quotes)*`;
};

export const formatProfileMarkdown = (data: unknown): string => {
  const item = firstItem<ProfileItem>(data);
  if (!item?.symbol) return '## Company Profile\n\nNo profile data available for that symbol.';

  const desc = item.description ? item.description.slice(0, 500) + (item.description.length > 500 ? '...' : '') : 'No description available.';

  const lines: string[] = [`## ${item.companyName || item.symbol} — Company Profile`];
  lines.push('');
  lines.push('| Detail | Value |');
  lines.push('|--------|-------|');
  lines.push(`| **Symbol** | ${item.symbol} |`);
  lines.push(`| **Sector** | ${item.sector || 'N/A'} |`);
  lines.push(`| **Industry** | ${item.industry || 'N/A'} |`);
  lines.push(`| **Exchange** | ${item.exchangeShortName || 'N/A'} |`);
  lines.push(`| **Market Cap** | ${fmtLargeNum(item.marketCap)} |`);
  if (item.website) lines.push(`| **Website** | [${item.website}](${item.website}) |`);
  lines.push('');
  lines.push(desc);
  lines.push('');
  lines.push('*Source: Financial Modeling Prep — free plan data*');

  return lines.join('\n');
};

export type DataToolKind =
  | 'quote'
  | 'profile'
  | 'earnings-calendar'
  | 'treasury-rates'
  | 'key-metrics'
  | 'statements'
  | 'ratios'
  | 'price-change'
  | 'dcf';

const FORMATTERS: Record<DataToolKind, (data: unknown) => string> = {
  'quote': formatQuoteMarkdown,
  'profile': formatProfileMarkdown,
  'earnings-calendar': formatEarningsCalendarMarkdown,
  'treasury-rates': formatTreasuryRatesMarkdown,
  'key-metrics': formatKeyMetricsMarkdown,
  'statements': () => '## Financial Statements\n\nUse formatStatementsMarkdown() with 3 params instead.',
  'ratios': () => '## Ratios & Growth\n\nUse formatRatiosMarkdown() with 2 params instead.',
  'price-change': formatPriceChangeMarkdown,
  'dcf': formatDcfMarkdown,
};

export const formatDataToolResponse = (kind: DataToolKind, data: unknown): string => {
  const formatter = FORMATTERS[kind];
  if (!formatter) return `## Unknown Data Tool\n\nNo formatter available for "${kind}".`;
  return formatter(data);
};

export const DATA_TOOL_LABELS: Record<DataToolKind, { label: string; icon: string; desc: string; needsSymbol: boolean }> = {
  'quote': { label: 'Stock Quote', icon: '💰', desc: 'Current stock price & volume', needsSymbol: true },
  'profile': { label: 'Company Profile', icon: '🏢', desc: 'Company overview & fundamentals', needsSymbol: true },
  'earnings-calendar': { label: 'Earnings Calendar', icon: '🗓️', desc: 'Upcoming earnings reports', needsSymbol: false },
  'treasury-rates': { label: 'Treasury Rates', icon: '🏦', desc: 'Yield curve data', needsSymbol: false },
  'key-metrics': { label: 'Key Metrics', icon: '📊', desc: 'P/E, EV, ROE & key ratios', needsSymbol: true },
  'statements': { label: 'Financial Statements', icon: '📋', desc: 'Income, balance & cash flow', needsSymbol: true },
  'ratios': { label: 'Ratios & Growth', icon: '📈', desc: 'Margins, ROE, growth rates', needsSymbol: true },
  'price-change': { label: 'Price Change', icon: '🔄', desc: 'Performance across timeframes', needsSymbol: true },
  'dcf': { label: 'DCF Valuation', icon: '💎', desc: 'Discounted cash flow fair value', needsSymbol: true },
};

export const DATA_TOOL_API_ROUTES: Record<DataToolKind, string> = {
  'quote': '/api/fmp/quote',
  'profile': '/api/fmp/profile',
  'earnings-calendar': '/api/fmp/earnings-calendar',
  'treasury-rates': '/api/fmp/treasury-rates',
  'key-metrics': '/api/fmp/key-metrics',
  'statements': '',  // Not a single route — handled in AIChat
  'ratios': '',      // Not a single route — handled in AIChat
  'price-change': '/api/fmp/price-change',
  'dcf': '/api/fmp/dcf',
};
