import { describe, expect, it } from 'vitest';
import {
  formatMarketNewsMarkdown,
  formatCompanyNewsMarkdown,
  formatInsiderTransactionsMarkdown,
  formatAnalystRecommendationsMarkdown,
  formatEconomicCalendarMarkdown,
  formatSecFilingsMarkdown,
  formatEarningsSurprisesMarkdown,
  formatPeerCompaniesMarkdown,
  formatMarketStatusMarkdown,
  formatFinnhubDataToolResponse,
} from './finnhubDataTools';

describe('formatMarketNewsMarkdown', () => {
  it('formats market news as a table', () => {
    const data = [
      { headline: 'Apple stock rises', source: 'Bloomberg', datetime: 1716000000, url: 'https://example.com', related: 'AAPL' },
      { headline: 'Fed holds rates steady', source: 'Reuters', datetime: 1715900000, url: 'https://example.com', related: '' },
    ];
    const result = formatMarketNewsMarkdown(data);
    expect(result).toContain('## Market News');
    expect(result).toContain('Apple stock rises');
    expect(result).toContain('Bloomberg');
    expect(result).toContain('Fed holds rates steady');
  });

  it('returns fallback for empty data', () => {
    expect(formatMarketNewsMarkdown([])).toContain('No market news');
  });
});

describe('formatCompanyNewsMarkdown', () => {
  it('formats company news with symbol', () => {
    const data = [
      { headline: 'AAPL product launch', source: 'CNBC', datetime: 1716000000, url: 'https://example.com' },
    ];
    const result = formatCompanyNewsMarkdown(data, 'AAPL');
    expect(result).toContain('## AAPL');
    expect(result).toContain('AAPL product launch');
    expect(result).toContain('CNBC');
  });

  it('returns fallback for empty data', () => {
    expect(formatCompanyNewsMarkdown([], 'AAPL')).toContain('No recent news');
  });
});

describe('formatInsiderTransactionsMarkdown', () => {
  it('formats insider transaction data', () => {
    const data = { data: [
      { symbol: 'AAPL', name: 'Tim Cook', share: 50000, value: 9000000, transactionCode: 'S', transactionDate: '2026-05-15', transactionPrice: 180 },
    ]};
    const result = formatInsiderTransactionsMarkdown(data);
    expect(result).toContain('## AAPL');
    expect(result).toContain('Tim Cook');
    expect(result).toContain('Sell');
    expect(result).toContain('50,000');
    expect(result).toContain('$9.00M');
  });

  it('returns fallback for empty data', () => {
    expect(formatInsiderTransactionsMarkdown([])).toContain('No insider transaction');
  });
});

describe('formatAnalystRecommendationsMarkdown', () => {
  it('formats recommendation data with consensus', () => {
    const data = [{ symbol: 'AAPL', strongBuy: 15, buy: 10, hold: 5, sell: 2, strongSell: 1, period: '2026-03-31' }];
    const result = formatAnalystRecommendationsMarkdown(data);
    expect(result).toContain('## AAPL');
    expect(result).toContain('Strong Buy');
    expect(result).toContain('15');
    expect(result).toContain('Buy');
    expect(result).toContain('Hold');
    expect(result).toContain('Bullish Ratio');
  });

  it('returns fallback for empty data', () => {
    expect(formatAnalystRecommendationsMarkdown([])).toContain('No analyst recommendation');
  });
});

describe('formatEconomicCalendarMarkdown', () => {
  it('formats economic events as a table', () => {
    const data = [
      { event: 'CPI YoY', country: 'US', impact: 'high', time: '2026-05-15 08:30:00', actual: 3.2, estimate: 3.3, prev: 3.1, unit: '%' },
    ];
    const result = formatEconomicCalendarMarkdown(data);
    expect(result).toContain('## Economic Calendar');
    expect(result).toContain('CPI YoY');
    expect(result).toContain('US');
    expect(result).toContain('HIGH');
    expect(result).toContain('3.2%');
  });

  it('returns fallback for empty data', () => {
    expect(formatEconomicCalendarMarkdown([])).toContain('No upcoming economic events');
  });
});

describe('formatSecFilingsMarkdown', () => {
  it('formats SEC filings data', () => {
    const data = [{ symbol: 'AAPL', form: '10-Q', filingDate: '2026-05-01', description: 'Quarterly report', filingUrl: 'https://sec.gov/filing' }];
    const result = formatSecFilingsMarkdown(data);
    expect(result).toContain('## AAPL');
    expect(result).toContain('10-Q');
    expect(result).toContain('Quarterly report');
  });

  it('returns fallback for empty data', () => {
    expect(formatSecFilingsMarkdown([])).toContain('No SEC filings');
  });
});

describe('formatEarningsSurprisesMarkdown', () => {
  it('formats earnings surprises', () => {
    const data = [{ symbol: 'AAPL', quarter: 2, year: 2026, actual: 1.52, estimate: 1.43, surprisePercent: 6.3, date: '2026-04-24' }];
    const result = formatEarningsSurprisesMarkdown(data);
    expect(result).toContain('## AAPL');
    expect(result).toContain('$1.43');
    expect(result).toContain('$1.52');
    expect(result).toContain('+6.30%');
  });

  it('returns fallback for empty data', () => {
    expect(formatEarningsSurprisesMarkdown([])).toContain('No earnings surprise');
  });
});

describe('formatPeerCompaniesMarkdown', () => {
  it('formats peer companies list', () => {
    const data = ['MSFT', 'GOOGL', 'AMZN', 'META'];
    const result = formatPeerCompaniesMarkdown(data);
    expect(result).toContain('## Peer Companies');
    expect(result).toContain('**MSFT**');
    expect(result).toContain('**AMZN**');
  });

  it('returns fallback for empty data', () => {
    expect(formatPeerCompaniesMarkdown([])).toContain('No peer comparison');
  });
});

describe('formatMarketStatusMarkdown', () => {
  it('formats market status (open)', () => {
    const data = { exchange: 'US', isOpen: true, tradingDay: '2026-05-18', previousTradingDay: '2026-05-15', nextTradingDay: '2026-05-19' };
    const result = formatMarketStatusMarkdown(data);
    expect(result).toContain('## Market Status');
    expect(result).toContain('US');
    expect(result).toContain('Open');
  });

  it('formats market status with holiday', () => {
    const data = { exchange: 'US', isOpen: false, isHoliday: true, holiday: 'Memorial Day', tradingDay: '2026-05-25' };
    const result = formatMarketStatusMarkdown(data);
    expect(result).toContain('Closed');
    expect(result).toContain('Memorial Day');
  });

  it('returns fallback for empty data', () => {
    expect(formatMarketStatusMarkdown([])).toContain('No market status');
  });
});

describe('formatFinnhubDataToolResponse', () => {
  it('dispatches to correct formatter', () => {
    const result = formatFinnhubDataToolResponse('market-news', [{ headline: 'Test' }]);
    expect(result).toContain('## Market News');
  });

  it('returns fallback for unknown kind', () => {
    const result = formatFinnhubDataToolResponse('unknown' as any, []);
    expect(result).toContain('Unknown Data Tool');
  });
});
