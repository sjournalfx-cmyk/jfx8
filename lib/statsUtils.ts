import { Trade } from '../types';
import { calculatePnLAtPrice } from './trade-calculations';
import { getCompletedTrades, sortTradesChronologically } from './analyticsUtils';

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const safeDateKey = (date: string | undefined): string | null => {
  if (!date || typeof date !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
};

export const calculateStats = (trades: Trade[]) => {
  const safeTrades = getCompletedTrades(trades || []);
  const wins = safeTrades.filter(t => t.result === 'Win');
  const losses = safeTrades.filter(t => t.result === 'Loss');
  const totalCount = safeTrades.length;
  
  const grossProfit = safeTrades.filter(t => toFiniteNumber(t.pnl, 0) > 0).reduce((acc, t) => acc + toFiniteNumber(t.pnl, 0), 0);
  const grossLoss = Math.abs(safeTrades.filter(t => toFiniteNumber(t.pnl, 0) < 0).reduce((acc, t) => acc + toFiniteNumber(t.pnl, 0), 0));
  const netProfit = safeTrades.reduce((acc, t) => acc + toFiniteNumber(t.pnl, 0), 0);
  
  const winRate = totalCount > 0 ? (wins.length / totalCount) * 100 : 0;
  const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss) : (grossProfit > 0 ? Number.POSITIVE_INFINITY : 0);
  
  const totalCommissions = safeTrades.reduce((acc, t) => acc + (t.commissions || 0), 0);
  const totalFees = safeTrades.reduce((acc, t) => acc + (t.fees || 0), 0);
  const totalSwap = safeTrades.reduce((acc, t) => acc + (t.swap || 0), 0);

  const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
  const riskRewardRatio = avgLoss > 0 ? (avgWin / avgLoss) : 0;

  // Streak calculations
  let maxWins = 0;
  let maxLosses = 0;
  let currentWins = 0;
  let currentLosses = 0;

  const sortedByTime = sortTradesChronologically(safeTrades);

  sortedByTime.forEach(t => {
    if (t.result === 'Win') {
      currentWins++;
      currentLosses = 0;
      if (currentWins > maxWins) maxWins = currentWins;
    } else if (t.result === 'Loss') {
      currentLosses++;
      currentWins = 0;
      if (currentLosses > maxLosses) maxLosses = currentLosses;
    } else {
      currentWins = 0;
      currentLosses = 0;
    }
  });

  // Hold time calculations (in minutes)
  const calculateHoldTime = (t: Trade) => {
    if (t.openTime && t.closeTime) {
      const start = new Date(t.openTime).getTime();
      const end = new Date(t.closeTime).getTime();
      const holdTime = (end - start) / (1000 * 60);
      return Number.isFinite(holdTime) ? holdTime : null;
    }
    return null;
  };

  const holdTimes = safeTrades.map(calculateHoldTime).filter((h): h is number => h !== null);
  const winHoldTimes = wins.map(calculateHoldTime).filter((h): h is number => h !== null);
  const lossHoldTimes = losses.map(calculateHoldTime).filter((h): h is number => h !== null);
  const beHoldTimes = safeTrades.filter(t => t.result === 'BE').map(calculateHoldTime).filter((h): h is number => h !== null);

  const avgHoldTime = holdTimes.length > 0 ? holdTimes.reduce((a, b) => a + b, 0) / holdTimes.length : 0;
  const avgWinHoldTime = winHoldTimes.length > 0 ? winHoldTimes.reduce((a, b) => a + b, 0) / winHoldTimes.length : 0;
  const avgLossHoldTime = lossHoldTimes.length > 0 ? lossHoldTimes.reduce((a, b) => a + b, 0) / lossHoldTimes.length : 0;
  const avgBEHoldTime = beHoldTimes.length > 0 ? beHoldTimes.reduce((a, b) => a + b, 0) / beHoldTimes.length : 0;

  // Daily Stats
  const dailyPnL: Record<string, number> = {};
  safeTrades.forEach(t => {
    const key = safeDateKey(t.date);
    if (!key) return;
    dailyPnL[key] = (dailyPnL[key] || 0) + toFiniteNumber(t.pnl, 0);
  });

  const dailyStats = Object.values(dailyPnL);
  const winningDays = dailyStats.filter(p => p > 0);
  const losingDays = dailyStats.filter(p => p < 0);
  const breakevenDays = dailyStats.filter(p => p === 0);

  const avgDailyPnL = dailyStats.length > 0 ? netProfit / dailyStats.length : 0;
  const avgWinningDay = winningDays.length > 0 ? winningDays.reduce((a, b) => a + b, 0) / winningDays.length : 0;
  const avgLosingDay = losingDays.length > 0 ? Math.abs(losingDays.reduce((a, b) => a + b, 0) / losingDays.length) : 0;

  const largestProfit = Math.max(0, ...safeTrades.map(t => toFiniteNumber(t.pnl, 0)));
  const largestLoss = Math.min(0, ...safeTrades.map(t => toFiniteNumber(t.pnl, 0)));
  
  const largestWinDay = Math.max(0, ...dailyStats);
  const largestLossDay = Math.min(0, ...dailyStats);

  // Daily Streaks
  let maxWinDays = 0;
  let maxLossDays = 0;
  let currentWinDays = 0;
  let currentLossDays = 0;

  const sortedDates = Object.keys(dailyPnL).sort();
  sortedDates.forEach(date => {
    const pnl = dailyPnL[date];
    if (pnl > 0) {
      currentWinDays++;
      currentLossDays = 0;
      if (currentWinDays > maxWinDays) maxWinDays = currentWinDays;
    } else if (pnl < 0) {
      currentLossDays++;
      currentWinDays = 0;
      if (currentLossDays > maxLossDays) maxLossDays = currentLossDays;
    } else {
      currentWinDays = 0;
      currentLossDays = 0;
    }
  });

  // Drawdown with percentage (using 100000 as default starting if not provided, though we should pass it)
  // For now, let's assume we use a reasonable starting point if we can't get it
  let peak = 0;
  let currentEquity = 0;
  let maxDD = 0;
  let totalDD = 0;
  let ddCount = 0;

  sortedByTime.forEach(t => {
    currentEquity += t.pnl;
    if (currentEquity > peak) {
      peak = currentEquity;
    }
    const dd = peak - currentEquity;
    if (dd > 0) {
      if (dd > maxDD) maxDD = dd;
      totalDD += dd;
      ddCount++;
    }
  });

  // Pair Stats
  const pairStats: Record<string, { pnl: number, trades: number, wins: number }> = {};
  safeTrades.forEach(t => {
    const pair = (t.pair || 'UNKNOWN').toUpperCase();
    if (!pairStats[pair]) pairStats[pair] = { pnl: 0, trades: 0, wins: 0 };
    pairStats[pair].pnl += toFiniteNumber(t.pnl, 0);
    pairStats[pair].trades += 1;
    if (t.result === 'Win') pairStats[pair].wins += 1;
  });

  const sortedPairs = Object.entries(pairStats).sort((a, b) => b[1].pnl - a[1].pnl);
  const bestPair = sortedPairs[0] ? { symbol: sortedPairs[0][0], pnl: sortedPairs[0][1].pnl } : null;
  const worstPair = sortedPairs[sortedPairs.length - 1] ? { symbol: sortedPairs[sortedPairs.length - 1][0], pnl: sortedPairs[sortedPairs.length - 1][1].pnl } : null;

  return {
    netProfit,
    grossProfit,
    grossLoss,
    winRate,
    profitFactor,
    avgWin,
    avgLoss,
    rrRatio: riskRewardRatio,
    totalTrades: safeTrades.length,
    numWins: wins.length,
    numLosses: losses.length,
    numBE: safeTrades.filter(t => t.result === 'BE').length,
    maxConsecutiveWins: maxWins,
    maxConsecutiveLosses: maxLosses,
    largestProfit,
    largestLoss,
    totalCommissions,
    totalFees,
    totalSwap,
    avgHoldTime,
    avgWinHoldTime,
    avgLossHoldTime,
    avgBEHoldTime,
    avgTradePnL: totalCount > 0 ? netProfit / totalCount : 0,
    
    // Column 2
    openTrades: trades.filter(t => t.result === 'Pending').length,
    totalTradingDays: Object.keys(dailyPnL).length,
    winningDays: winningDays.length,
    losingDays: losingDays.length,
    breakevenDays: breakevenDays.length,
    avgDailyPnL,
    avgWinningDay,
    avgLosingDay,
    largestWinDay,
    largestLossDay,
    tradeExpectancy: totalCount > 0 ? (winRate/100 * avgWin) - ((1 - winRate/100) * avgLoss) : 0,
    maxDrawdown: maxDD,
    avgDrawdown: ddCount > 0 ? totalDD / ddCount : 0,
    maxConsecutiveWinDays: maxWinDays,
    maxConsecutiveLossDays: maxLossDays,
    
    // Pair Stats for AI Snapshot
    pairStats,
    bestPair,
    worstPair,
    
    avgPlannedR: totalCount > 0 ? safeTrades.reduce((acc, t) => acc + toFiniteNumber(t.rr, 0), 0) / totalCount : 0,
    avgRealizedR: (() => {
      const realizedRs = safeTrades
        .map((trade) => {
          const riskAmount = Math.abs(calculatePnLAtPrice(trade, toFiniteNumber(trade.stopLoss, NaN)));
          if (!Number.isFinite(riskAmount) || riskAmount <= 0) {
            return null;
          }
          return toFiniteNumber(trade.pnl, 0) / riskAmount;
        })
        .filter((value): value is number => value !== null);

      return realizedRs.length > 0 ? realizedRs.reduce((acc, value) => acc + value, 0) / realizedRs.length : 0;
    })()
  };
};
