import { Trade } from '../types';

const getPipSize = (pair: string) => (pair.toUpperCase().includes('JPY') ? 0.01 : 0.0001);

/**
 * cTrader closing deals were synced with an inverted direction (the closing
 * deal's tradeSide is the execution side, which is opposite to the position
 * side). A stored direction is therefore wrong when its implied outcome
 * contradicts the broker-reported PnL sign. Ambiguous cases (break-even,
 * missing prices, moves too small to be decisive over fees) are left as-is.
 */
export const repairCtraderTradeDirections = (trades: Trade[]): { trades: Trade[]; changed: Trade[] } => {
  const changed: Trade[] = [];

  const repaired = trades.map(trade => {
    if (!trade.tags?.includes('cTrader')) return trade;

    const entry = Number(trade.entryPrice);
    const exit = Number(trade.exitPrice);
    const pnl = Number(trade.pnl);
    if (!Number.isFinite(entry) || !Number.isFinite(exit) || !Number.isFinite(pnl)) return trade;
    if (entry <= 0 || exit <= 0 || exit === entry || pnl === 0) return trade;

    const pipSize = getPipSize(trade.pair);
    const movePips = ((exit - entry) / pipSize) * (trade.direction === 'Long' ? 1 : -1);
    const lots = Number(trade.lots) || 0;
    const pipValueUsd = (pipSize === 0.01 ? 6.6 : 10) * lots;
    const feeBuffer = 10 * lots;

    if (Math.abs(movePips) * pipValueUsd <= Math.abs(pnl) + feeBuffer) return trade;

    const contradicts = (pnl > 0 && movePips < 0) || (pnl < 0 && movePips > 0);
    if (!contradicts) return trade;

    const repairedTrade: Trade = { ...trade, direction: trade.direction === 'Long' ? 'Short' : 'Long' };
    changed.push(repairedTrade);
    return repairedTrade;
  });

  return { trades: repaired, changed };
};
