import { describe, expect, it } from 'vitest';
import {
  formatKeyMetricsMarkdown,
  formatStatementsMarkdown,
  formatRatiosMarkdown,
  formatPriceChangeMarkdown,
  formatDcfMarkdown,
  formatEarningsCalendarMarkdown,
  formatTreasuryRatesMarkdown,
  formatQuoteMarkdown,
  formatProfileMarkdown,
  formatDataToolResponse,
} from './fmpDataTools';

describe('formatKeyMetricsMarkdown', () => {
  it('formats key metrics with table', () => {
    const data = [{
      symbol: 'AAPL',
      marketCap: 2800000000000,
      enterpriseValueTTM: 2900000000000,
      peRatioTTM: 28.5,
      priceToSalesRatioTTM: 7.2,
      priceToBookRatioTTM: 45.0,
      debtToEquityTTM: 1.5,
      returnOnEquityTTM: 0.35,
      returnOnAssetsTTM: 0.12,
      currentRatioTTM: 1.1,
      dividendYieldTTM: 0.005,
      freeCashFlowYieldTTM: 0.03,
    }];
    const result = formatKeyMetricsMarkdown(data);
    expect(result).toContain('## AAPL — Key Metrics');
    expect(result).toContain('$2.80T');
    expect(result).toContain('28.50');
    expect(result).toContain('+35.00%');
    expect(result).toContain('+0.50%');
    expect(result).toContain('+3.00%');
  });

  it('returns fallback for empty data', () => {
    expect(formatKeyMetricsMarkdown([])).toContain('No metrics data');
  });
});

describe('formatStatementsMarkdown', () => {
  it('formats all three statements', () => {
    const income = [{ symbol: 'AAPL', date: '2025-09-27', reportedCurrency: 'USD', revenue: 400000000000, grossProfit: 180000000000, netIncome: 100000000000 }];
    const balance = [{ symbol: 'AAPL', totalAssets: 350000000000, totalLiabilities: 250000000000, totalShareholderEquity: 100000000000 }];
    const cashFlow = [{ symbol: 'AAPL', operatingCashFlow: 120000000000, freeCashFlow: 100000000000 }];
    const result = formatStatementsMarkdown(income, balance, cashFlow);
    expect(result).toContain('## AAPL — Financial Statements');
    expect(result).toContain('### Income Statement');
    expect(result).toContain('### Balance Sheet');
    expect(result).toContain('### Cash Flow');
    expect(result).toContain('$400.00B');
    expect(result).toContain('$350.00B');
    expect(result).toContain('$120.00B');
  });

  it('returns fallback for empty data', () => {
    expect(formatStatementsMarkdown([], [], [])).toContain('No statement data');
  });
});

describe('formatRatiosMarkdown', () => {
  it('formats ratios and growth data', () => {
    const ratios = [{
      symbol: 'AAPL',
      grossProfitMarginTTM: 0.45,
      netProfitMarginTTM: 0.25,
      returnOnEquityTTM: 0.35,
      debtToEquityTTM: 1.5,
      currentRatioTTM: 1.1,
      payoutRatioTTM: 0.15,
    }];
    const growth = [{
      symbol: 'AAPL',
      revenueGrowth: 0.08,
      netIncomeGrowth: 0.12,
      epsGrowth: 0.10,
    }];
    const result = formatRatiosMarkdown(ratios, growth);
    expect(result).toContain('## AAPL — Ratios & Growth');
    expect(result).toContain('+45.00%');
    expect(result).toContain('+35.00%');
    expect(result).toContain('### Growth Rates');
    expect(result).toContain('+8.00%');
  });

  it('works without growth data', () => {
    const ratios = [{ symbol: 'AAPL', grossProfitMarginTTM: 0.45 }];
    const result = formatRatiosMarkdown(ratios, []);
    expect(result).toContain('## AAPL — Ratios & Growth');
    expect(result).not.toContain('Growth Rates');
  });

  it('returns fallback for empty data', () => {
    expect(formatRatiosMarkdown([], [])).toContain('No data available');
  });
});

describe('formatPriceChangeMarkdown', () => {
  it('formats price changes across periods', () => {
    const data = [{
      symbol: 'AAPL',
      '1D': 0.68,
      '5D': 2.29,
      '1M': 11.10,
      '3M': 13.57,
      '6M': 12.20,
      '1Y': 35.00,
    }];
    const result = formatPriceChangeMarkdown(data);
    expect(result).toContain('## AAPL — Price Change');
    expect(result).toContain('+0.68%');
    expect(result).toContain('+2.29%');
    expect(result).toContain('+35.00%');
    expect(result).toContain('1 Day');
    expect(result).toContain('1 Year');
  });

  it('returns fallback for empty data', () => {
    expect(formatPriceChangeMarkdown([])).toContain('No price change data');
  });
});

describe('formatDcfMarkdown', () => {
  it('formats DCF data with valuation verdict', () => {
    const data = [{ symbol: 'AAPL', dcf: 200, 'Stock Price': 300 }];
    const result = formatDcfMarkdown(data);
    expect(result).toContain('## AAPL — DCF Valuation');
    expect(result).toContain('$200.00');
    expect(result).toContain('$300.00');
    expect(result).toContain('Overvalued');
    expect(result).toContain('50.0%');
  });

  it('shows undervalued when price is below DCF', () => {
    const data = [{ symbol: 'AAPL', dcf: 300, 'Stock Price': 200 }];
    const result = formatDcfMarkdown(data);
    expect(result).toContain('Undervalued');
  });

  it('returns fallback for empty data', () => {
    expect(formatDcfMarkdown([])).toContain('No DCF data');
  });
});

describe('formatEarningsCalendarMarkdown', () => {
  it('formats earnings data as a table', () => {
    const data = [
      { date: '2026-05-20', symbol: 'AAPL', epsEstimated: 1.5, revenueEstimated: 90000000, time: 'AMC' },
    ];
    const result = formatEarningsCalendarMarkdown(data);
    expect(result).toContain('## Earnings Calendar');
    expect(result).toContain('AAPL');
    expect(result).toContain('$1.50');
    expect(result).toContain('$90,000,000');
  });

  it('returns fallback for empty data', () => {
    expect(formatEarningsCalendarMarkdown([])).toContain('No upcoming earnings');
  });
});

describe('formatTreasuryRatesMarkdown', () => {
  it('formats treasury data as a table', () => {
    const data = [
      { maturity: '10Y', yield: '4.50', date: '2026-05-18' },
    ];
    const result = formatTreasuryRatesMarkdown(data);
    expect(result).toContain('## Treasury Rates');
    expect(result).toContain('10Y');
    expect(result).toContain('4.50%');
  });

  it('returns fallback for empty data', () => {
    expect(formatTreasuryRatesMarkdown([])).toContain('No treasury rate data');
  });
});

describe('formatQuoteMarkdown', () => {
  it('formats quote data in a table', () => {
    const data = [{ symbol: 'AAPL', price: 180.5, change: 2.3, changesPercentage: 1.29, dayLow: 178, dayHigh: 181, volume: 50000000, marketCap: 2800000000000, previousClose: 178.2 }];
    const result = formatQuoteMarkdown(data);
    expect(result).toContain('## AAPL');
    expect(result).toContain('$180.50');
    expect(result).toContain('$2.30');
    expect(result).toContain('+1.29%');
    expect(result).toContain('$2.80T');
  });

  it('returns fallback for empty data', () => {
    expect(formatQuoteMarkdown([])).toContain('No quote data');
  });
});

describe('formatProfileMarkdown', () => {
  it('formats profile data with details', () => {
    const data = [{ symbol: 'AAPL', companyName: 'Apple Inc.', sector: 'Technology', industry: 'Consumer Electronics', marketCap: 2800000000000, exchangeShortName: 'NASDAQ', description: 'Apple designs and manufactures smartphones and computers.', website: 'https://apple.com' }];
    const result = formatProfileMarkdown(data);
    expect(result).toContain('Apple Inc.');
    expect(result).toContain('Technology');
    expect(result).toContain('$2.80T');
    expect(result).toContain('NASDAQ');
    expect(result).toContain('apple.com');
  });

  it('returns fallback for empty data', () => {
    expect(formatProfileMarkdown([])).toContain('No profile data');
  });
});

describe('formatDataToolResponse', () => {
  it('dispatches to the correct formatter based on kind', () => {
    const quoteResult = formatDataToolResponse('quote', [{ symbol: 'AAPL', price: 100 }]);
    expect(quoteResult).toContain('## AAPL');
  });

  it('returns fallback for unknown kind', () => {
    const result = formatDataToolResponse('unknown' as any, []);
    expect(result).toContain('Unknown Data Tool');
  });
});
