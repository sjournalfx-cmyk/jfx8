type MarketNewsItem = {
  category?: string;
  datetime?: number;
  headline?: string;
  id?: number;
  image?: string;
  related?: string;
  source?: string;
  summary?: string;
  url?: string;
};

type InsiderTransactionItem = {
  symbol?: string;
  name?: string;
  share?: number;
  change?: number;
  filingDate?: string;
  transactionDate?: string;
  transactionPrice?: number;
  transactionCode?: string;
  value?: number;
};

type RecommendationItem = {
  symbol?: string;
  buy?: number;
  hold?: number;
  sell?: number;
  strongBuy?: number;
  strongSell?: number;
  period?: string;
};

type EconomicEventItem = {
  actual?: number;
  prev?: number;
  country?: string;
  estimate?: number;
  event?: string;
  impact?: string;
  time?: string;
  unit?: string;
};

type FilingItem = {
  symbol?: string;
  filingDate?: string;
  acceptedDate?: string;
  filingUrl?: string;
  reportUrl?: string;
  form?: string;
  cik?: string;
  description?: string;
};

type EarningsSurpriseItem = {
  symbol?: string;
  quarter?: number;
  year?: number;
  actual?: number;
  estimate?: number;
  surprise?: number;
  surprisePercent?: number;
  date?: string;
};

type MarketStatusItem = {
  exchange?: string;
  isOpen?: boolean;
  holiday?: string;
  isHoliday?: boolean;
  tradingDay?: string;
  previousTradingDay?: string;
  nextTradingDay?: string;
};

const firstItem = <T>(data: unknown): T | undefined =>
  (Array.isArray(data) ? data[0] : data) as T | undefined;

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

const unixToDate = (ts: number | undefined | null): string => {
  if (!ts) return 'N/A';
  try {
    return new Date(ts * 1000).toISOString().split('T')[0];
  } catch {
    return 'N/A';
  }
};

const truncate = (text: string | undefined | null, max = 200): string => {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '...' : text;
};

export const formatMarketNewsMarkdown = (data: unknown): string => {
  const items = (Array.isArray(data) ? data : []) as MarketNewsItem[];
  if (items.length === 0) return '## Market News\n\nNo market news available.';

  const rows = items.slice(0, 12).map((item) => {
    const date = unixToDate(item.datetime);
    const related = item.related ? ` (${item.related})` : '';
    return `| ${date} | [${truncate(item.headline, 80)}](${item.url || '#'}) | ${item.source || 'N/A'}${related} |`;
  });

  return `## Market News\n\n| Date | Headline | Source |\n|------|----------|--------|\n${rows.join('\n')}\n\n*Source: Finnhub — free plan data*`;
};

export const formatCompanyNewsMarkdown = (data: unknown, symbol?: string): string => {
  const items = (Array.isArray(data) ? data : []) as MarketNewsItem[];
  if (items.length === 0) return `## ${symbol || 'Company'} News\n\nNo recent news for ${symbol || 'this symbol'}.`;

  const rows = items.slice(0, 10).map((item) => {
    const date = unixToDate(item.datetime);
    return `| ${date} | [${truncate(item.headline, 80)}](${item.url || '#'}) | ${item.source || 'N/A'} |`;
  });

  return `## ${symbol || 'Company'} — Recent News\n\n| Date | Headline | Source |\n|------|----------|--------|\n${rows.join('\n')}\n\n*Source: Finnhub — free plan data*`;
};

export const formatInsiderTransactionsMarkdown = (data: unknown): string => {
  const raw = data as { data?: InsiderTransactionItem[] } | undefined;
  const items = raw?.data || (Array.isArray(data) ? data : []) as InsiderTransactionItem[];
  if (items.length === 0) return '## Insider Transactions\n\nNo insider transaction data available for that symbol.';

  const symbol = items[0]?.symbol || 'Unknown';
  const rows = items.slice(0, 15).map((item) => {
    const code = item.transactionCode === 'S' ? 'Sell' : item.transactionCode === 'P' ? 'Buy' : item.transactionCode || 'N/A';
    const value = item.value != null ? fmtLargeNum(item.value) : 'N/A';
    return `| ${item.transactionDate || 'N/A'} | ${item.name || 'N/A'} | ${code} | ${item.share?.toLocaleString() || 'N/A'} | ${value} |`;
  });

  return `## ${symbol} — Insider Transactions\n\n| Date | Insider | Action | Shares | Value |\n|------|---------|--------|--------|-------|\n${rows.join('\n')}\n\n*Source: Finnhub — free plan data*`;
};

export const formatAnalystRecommendationsMarkdown = (data: unknown): string => {
  const items = (Array.isArray(data) ? data : []) as RecommendationItem[];
  if (items.length === 0) return '## Analyst Recommendations\n\nNo analyst recommendation data available for that symbol.';

  const latest = items[0];
  const symbol = latest.symbol || 'Unknown';
  const total = (latest.strongBuy || 0) + (latest.buy || 0) + (latest.hold || 0) + (latest.sell || 0) + (latest.strongSell || 0);
  const consensus = latest.strongBuy && latest.buy && latest.sell && latest.strongSell
    ? ((latest.strongBuy + latest.buy) / (total || 1) * 100).toFixed(0)
    : 'N/A';

  return `## ${symbol} — Analyst Recommendations (${latest.period || 'Latest'})\n\n| Rating | Count |\n|--------|-------|\n| **Strong Buy** | ${latest.strongBuy ?? 0} |\n| **Buy** | ${latest.buy ?? 0} |\n| **Hold** | ${latest.hold ?? 0} |\n| **Sell** | ${latest.sell ?? 0} |\n| **Strong Sell** | ${latest.strongSell ?? 0} |\n\n**Total Analysts:** ${total}\n\n**Bullish Ratio:** ${consensus !== 'N/A' ? `${consensus}% buy/strong-buy` : 'N/A'}\n\n*Source: Finnhub — free plan data*`;
};

export const formatEconomicCalendarMarkdown = (data: unknown): string => {
  const items = (Array.isArray(data) ? data : []) as EconomicEventItem[];
  if (items.length === 0) return '## Economic Calendar\n\nNo upcoming economic events found.';

  const header = '| Date | Country | Event | Impact | Actual | Estimate | Previous |';
  const sep = '|------|---------|-------|--------|--------|----------|----------|';
  const rows = items.slice(0, 20).map((item) => {
    const actual = item.actual != null ? item.actual : '-';
    const estimate = item.estimate != null ? item.estimate : '-';
    const prev = item.prev != null ? item.prev : '-';
    const unit = item.unit || '';
    return `| ${item.time ? item.time.split(' ')[0] : 'N/A'} | ${item.country || 'N/A'} | ${item.event || 'N/A'} | ${(item.impact || 'N/A').toUpperCase()} | ${actual}${unit} | ${estimate}${unit} | ${prev}${unit} |`;
  });

  return `## Economic Calendar\n\n${header}\n${sep}\n${rows.join('\n')}\n\n*Source: Finnhub — free plan data*`;
};

export const formatSecFilingsMarkdown = (data: unknown): string => {
  const items = (Array.isArray(data) ? data : []) as FilingItem[];
  if (items.length === 0) return '## SEC Filings\n\nNo SEC filings found for that symbol.';

  const symbol = items[0]?.symbol || 'Unknown';
  const rows = items.slice(0, 10).map((item) => {
    const desc = truncate(item.description, 60);
    const url = item.filingUrl || item.reportUrl;
    return `| ${item.filingDate || 'N/A'} | ${item.form || 'N/A'} | ${url ? `[${desc || 'View Filing'}](${url})` : desc || 'N/A'} |`;
  });

  return `## ${symbol} — SEC Filings\n\n| Date | Form | Description |\n|------|------|-------------|\n${rows.join('\n')}\n\n*Source: Finnhub — free plan data*`;
};

export const formatEarningsSurprisesMarkdown = (data: unknown): string => {
  const items = (Array.isArray(data) ? data : []) as EarningsSurpriseItem[];
  if (items.length === 0) return '## Earnings Surprises\n\nNo earnings surprise data available for that symbol.';

  const symbol = items[0]?.symbol || 'Unknown';
  const rows = items.slice(0, 8).map((item) => {
    const surprise = item.surprisePercent != null ? `${item.surprisePercent >= 0 ? '+' : ''}${item.surprisePercent.toFixed(2)}%` : 'N/A';
    return `| ${item.date || `Q${item.quarter} ${item.year}`} | $${fmtNum(item.estimate)} | $${fmtNum(item.actual)} | ${surprise} |`;
  });

  return `## ${symbol} — Earnings Surprises\n\n| Period | Est. EPS | Actual EPS | Surprise |\n|--------|----------|------------|----------|\n${rows.join('\n')}\n\n*Source: Finnhub — free plan data*`;
};

export const formatPeerCompaniesMarkdown = (data: unknown): string => {
  const items = (Array.isArray(data) ? data : []) as string[];
  if (items.length === 0) return '## Peer Companies\n\nNo peer comparison data available for that symbol.';

  const peers = items.map((s) => `- **${s.trim()}**`).join('\n');
  return `## Peer Companies\n\n${peers}\n\n*Source: Finnhub — free plan data*`;
};

export const formatMarketStatusMarkdown = (data: unknown): string => {
  const item = firstItem<MarketStatusItem>(data) || (data as MarketStatusItem);
  if (!item?.exchange) return '## Market Status\n\nNo market status data available.';

  const status = item.isOpen ? '🟢 **Open**' : '🔴 **Closed**';
  const holiday = item.isHoliday ? `\n\n> **Holiday:** ${item.holiday || 'Market holiday'}` : '';

  return `## Market Status — ${item.exchange}\n\n| Metric | Value |\n|--------|-------|\n| **Status** | ${status} |\n| **Trading Day** | ${item.tradingDay || 'N/A'} |\n| **Previous Day** | ${item.previousTradingDay || 'N/A'} |\n| **Next Day** | ${item.nextTradingDay || 'N/A'} |${holiday}\n\n*Source: Finnhub — free plan data*`;
};

export type FinnhubToolKind =
  | 'market-news'
  | 'company-news'
  | 'insider-transactions'
  | 'analyst-recommendations'
  | 'economic-calendar'
  | 'sec-filings'
  | 'earnings-surprises'
  | 'peer-companies'
  | 'market-status';

type FormatterFn = (data: unknown, symbol?: string) => string;

const FORMATTERS: Record<FinnhubToolKind, FormatterFn> = {
  'market-news': (data) => formatMarketNewsMarkdown(data),
  'company-news': (data, symbol) => formatCompanyNewsMarkdown(data, symbol),
  'insider-transactions': (data) => formatInsiderTransactionsMarkdown(data),
  'analyst-recommendations': (data) => formatAnalystRecommendationsMarkdown(data),
  'economic-calendar': (data) => formatEconomicCalendarMarkdown(data),
  'sec-filings': (data) => formatSecFilingsMarkdown(data),
  'earnings-surprises': (data) => formatEarningsSurprisesMarkdown(data),
  'peer-companies': (data) => formatPeerCompaniesMarkdown(data),
  'market-status': (data) => formatMarketStatusMarkdown(data),
};

export const formatFinnhubDataToolResponse = (kind: FinnhubToolKind, data: unknown, symbol?: string): string => {
  const formatter = FORMATTERS[kind];
  if (!formatter) return `## Unknown Data Tool\n\nNo formatter available for "${kind}".`;
  return formatter(data, symbol);
};

export const FINNHUB_TOOL_LABELS: Record<FinnhubToolKind, { label: string; icon: string; desc: string; needsSymbol: boolean }> = {
  'market-news': { label: 'Market News', icon: '📰', desc: 'General market headlines', needsSymbol: false },
  'company-news': { label: 'Company News', icon: '📰', desc: 'News by ticker symbol', needsSymbol: true },
  'insider-transactions': { label: 'Insider Trades', icon: '🔒', desc: 'Insider buying & selling', needsSymbol: true },
  'analyst-recommendations': { label: 'Analyst Ratings', icon: '🎯', desc: 'Buy/hold/sell consensus', needsSymbol: true },
  'economic-calendar': { label: 'Economic Calendar', icon: '📅', desc: 'CPI, GDP, jobs & macro events', needsSymbol: false },
  'sec-filings': { label: 'SEC Filings', icon: '📋', desc: '10-K, 10-Q & other filings', needsSymbol: true },
  'earnings-surprises': { label: 'Earnings Surprises', icon: '💡', desc: 'Historical beat/miss rates', needsSymbol: true },
  'peer-companies': { label: 'Peer Comparison', icon: '🏢', desc: 'Similar companies', needsSymbol: true },
  'market-status': { label: 'Market Status', icon: '🔴', desc: 'Open/closed & holidays', needsSymbol: false },
};

export const FINNHUB_TOOL_API_ROUTES: Record<FinnhubToolKind, string> = {
  'market-news': '/api/finnhub/market-news',
  'company-news': '/api/finnhub/company-news',
  'insider-transactions': '/api/finnhub/insider-transactions',
  'analyst-recommendations': '/api/finnhub/analyst-recommendations',
  'economic-calendar': '/api/finnhub/economic-calendar',
  'sec-filings': '/api/finnhub/sec-filings',
  'earnings-surprises': '/api/finnhub/earnings-surprises',
  'peer-companies': '/api/finnhub/peer-companies',
  'market-status': '/api/finnhub/market-status',
};
