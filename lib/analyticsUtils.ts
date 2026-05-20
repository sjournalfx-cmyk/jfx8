import { Trade } from '../types';

export const isCompletedTrade = (trade: Trade): boolean => trade.result !== 'Pending';

export const getCompletedTrades = (trades: Trade[] = []): Trade[] => trades.filter(isCompletedTrade);

export const getTradeTimestamp = (trade: Trade): number => {
  const dateTime = `${trade.date}T${trade.time || '00:00'}`;
  const parsed = new Date(dateTime).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

export const sortTradesChronologically = (trades: Trade[] = []): Trade[] => {
  return [...trades].sort((a, b) => getTradeTimestamp(a) - getTradeTimestamp(b));
};
