import { DailyBias, EASession, Trade, UserProfile } from '../types';
import { APP_CONSTANTS } from './constants';
import { calculateStats } from './statsUtils';
import { getSafePnL } from './trade-normalization';
import { getSastHourFromTrade } from './timeUtils';

const round = (value: number, decimals = 2) => Number(value.toFixed(decimals));

const getTradeDateTime = (trade: Trade) => new Date(`${trade.date}T${trade.time || '00:00'}`);

const getSessionLabel = (trade: Trade) => {
  const session = trade.session && trade.session !== 'Session' ? trade.session : '';
  if (/Asia|Tokyo|Sydney/i.test(session)) return 'Asian';
  if (/London/i.test(session) && !/York/i.test(session)) return 'London';
  if (/Overlap/i.test(session) || (/London/i.test(session) && /York/i.test(session))) return 'Overlap';
  if (/York/i.test(session)) return 'New York';

  const hour = parseInt((trade.time || '00:00').split(':')[0], 10);
  if (Number.isNaN(hour)) return 'Unknown';
  if (hour >= 0 && hour < 9) return 'Asian';
  if (hour >= 9 && hour < 15) return 'London';
  if (hour >= 15 && hour < 18) return 'Overlap';
  if (hour >= 18) return 'New York';
  return 'Unknown';
};

const stripHtml = (html?: string) => {
  if (!html) return 'All Rules';
  const text = html.replace(/<[^>]*>?/gm, '').trim();
  return text || 'All Rules';
};

const buildEffectiveInitialBalance = (trades: Trade[], userProfile: UserProfile | null, eaSession?: EASession | null) => {
  const isHobby = userProfile?.plan === APP_CONSTANTS.PLANS.HOBBY;
  const isStandard = userProfile?.plan === APP_CONSTANTS.PLANS.STANDARD;
  if ((isHobby || isStandard) && eaSession?.data?.account?.balance !== undefined) {
    const totalPnL = trades.reduce((sum, trade) => sum + getSafePnL(trade.pnl), 0);
    return eaSession.data.account.balance - totalPnL;
  }
  return userProfile?.initialBalance || 0;
};

export const buildAnalyticsAiSnapshot = (
  rawTrades: Trade[] = [],
  userProfile: UserProfile | null,
  dailyBias: DailyBias[] = [],
  eaSession?: EASession | null
) => {
  const trades = [...rawTrades].sort((a, b) => getTradeDateTime(a).getTime() - getTradeDateTime(b).getTime());
  const stats = calculateStats(trades);
  const currencySymbol = userProfile?.currencySymbol || '$';
  const effectiveInitialBalance = buildEffectiveInitialBalance(trades, userProfile, eaSession);
  const currentBalance = round(effectiveInitialBalance + trades.reduce((sum, trade) => sum + getSafePnL(trade.pnl), 0));

  let runningBalance = effectiveInitialBalance;
  let peakBalance = effectiveInitialBalance;
  const equityCurve = trades.map((trade, index) => {
    runningBalance += getSafePnL(trade.pnl);
    peakBalance = Math.max(peakBalance, runningBalance);
    const drawdownPercent = peakBalance > 0 ? ((peakBalance - runningBalance) / peakBalance) * 100 : 0;
    return {
      index: index + 1,
      date: trade.date,
      time: trade.time,
      pair: trade.pair,
      pnl: round(getSafePnL(trade.pnl)),
      balance: round(runningBalance),
      drawdownPercent: round(drawdownPercent),
    };
  });

  const maxDrawdownPercent = equityCurve.length > 0 ? Math.max(...equityCurve.map(point => point.drawdownPercent)) : 0;

  const pairStats = Object.entries(stats.pairStats)
    .map(([pair, data]) => ({
      pair,
      pnl: round(data.pnl),
      trades: data.trades,
      wins: data.wins,
      winRate: round(data.trades > 0 ? (data.wins / data.trades) * 100 : 0, 1),
      avgPnl: round(data.trades > 0 ? data.pnl / data.trades : 0),
    }))
    .sort((a, b) => b.pnl - a.pnl);

  const symbolPerformance = {
    bestSymbolSum: pairStats[0] || null,
    worstSymbolSum: pairStats[pairStats.length - 1] || null,
    bestSymbolAvg: [...pairStats].sort((a, b) => b.avgPnl - a.avgPnl)[0] || null,
    worstSymbolAvg: [...pairStats].sort((a, b) => a.avgPnl - b.avgPnl)[0] || null,
  };

  const largestWinTrade = [...trades].sort((a, b) => getSafePnL(b.pnl) - getSafePnL(a.pnl))[0] || null;
  const largestLossTrade = [...trades].sort((a, b) => getSafePnL(a.pnl) - getSafePnL(b.pnl))[0] || null;

  const outcomeDistribution = {
    wins: trades.filter(trade => trade.result === 'Win').length,
    losses: trades.filter(trade => trade.result === 'Loss').length,
    breakeven: trades.filter(trade => trade.result === 'BE').length,
    pending: trades.filter(trade => trade.result === 'Pending').length,
  };

  const exitAnalysis = [
    { label: 'Take Profit', key: 'TP', value: outcomeDistribution.wins },
    { label: 'Stop Loss', key: 'SL', value: outcomeDistribution.losses },
    { label: 'Breakeven', key: 'BE', value: outcomeDistribution.breakeven },
    { label: 'Pending', key: 'P', value: outcomeDistribution.pending },
  ].map(item => ({
    ...item,
    percent: round(trades.length > 0 ? (item.value / trades.length) * 100 : 0, 1),
  }));

  const adherenceOrder = ['Followed Exactly', 'Minor Deviation', 'Major Deviation', 'No Plan'];
  const planAdherence = adherenceOrder.map(label => {
    const related = trades.filter(trade => (trade.planAdherence || 'No Plan') === label);
    const profit = related.filter(trade => getSafePnL(trade.pnl) > 0).reduce((sum, trade) => sum + getSafePnL(trade.pnl), 0);
    const loss = related.filter(trade => getSafePnL(trade.pnl) <= 0).reduce((sum, trade) => sum + Math.abs(getSafePnL(trade.pnl)), 0);
    return {
      label,
      count: related.length,
      profit: round(profit),
      loss: round(loss),
      net: round(profit - loss),
    };
  });

  const mindsetOrder = ['Confident', 'Neutral', 'Hesitant', 'Anxious', 'FOMO'];
  const mindsetPerformance = mindsetOrder.map(label => {
    const related = trades.filter(trade => (trade.mindset || 'Neutral') === label);
    const profit = related.filter(trade => getSafePnL(trade.pnl) > 0).reduce((sum, trade) => sum + getSafePnL(trade.pnl), 0);
    const loss = related.filter(trade => getSafePnL(trade.pnl) <= 0).reduce((sum, trade) => sum + Math.abs(getSafePnL(trade.pnl)), 0);
    return {
      label,
      count: related.length,
      profit: round(profit),
      loss: round(loss),
      net: round(profit - loss),
    };
  });

  const disciplineScore = (() => {
    if (trades.length === 0) return { score: 100, label: 'No Data', message: 'Start logging trades to see your tilt score.' };
    let totalScore = 0;
    let count = 0;
    trades.forEach(trade => {
      if (trade.planAdherence === 'Followed Exactly') totalScore += 100;
      else if (trade.planAdherence === 'Minor Deviation') totalScore += 50;
      else if (trade.planAdherence === 'Major Deviation') totalScore += 0;
      else if (trade.planAdherence === 'No Plan') totalScore += 20;
      else return;
      count += 1;
    });
    const score = count > 0 ? Math.round(totalScore / count) : 100;
    if (score >= 90) return { score, label: 'Elite', message: 'Ice in your veins. Keep it up.' };
    if (score >= 75) return { score, label: 'Good', message: 'Solid discipline, watch out for small slips.' };
    if (score >= 60) return { score, label: 'Average', message: 'Inconsistent. Focus on following your plan.' };
    return { score, label: 'Poor', message: 'Your discipline needs immediate attention.' };
  })();

  const momentum = (() => {
    const grouped: { id: string; result: string; pair: string }[] = [];
    let index = 0;
    while (index < trades.length) {
      const current = trades[index];
      const setupId = current.setupId;
      const result = current.result;
      if (setupId) {
        let count = 1;
        while (
          index + count < trades.length &&
          trades[index + count].setupId === setupId &&
          trades[index + count].result === result
        ) {
          count += 1;
        }
        grouped.push({ id: `${setupId}-${index}`, result, pair: current.pair });
        index += count;
      } else {
        grouped.push({ id: current.id, result, pair: current.pair });
        index += 1;
      }
    }
    let longestWin = 0;
    let longestLoss = 0;
    let tempWin = 0;
    let tempLoss = 0;
    grouped.forEach(item => {
      if (item.result === 'Win') {
        tempWin += 1;
        tempLoss = 0;
        longestWin = Math.max(longestWin, tempWin);
      } else if (item.result === 'Loss') {
        tempLoss += 1;
        tempWin = 0;
        longestLoss = Math.max(longestLoss, tempLoss);
      } else {
        tempWin = 0;
        tempLoss = 0;
      }
    });
    let currentStreakType: string | null = null;
    let currentStreakValue = 0;
    const reversed = [...grouped].reverse();
    if (reversed.length > 0) {
      currentStreakType = reversed[0].result;
      for (const item of reversed) {
        if (item.result === currentStreakType) currentStreakValue += 1;
        else break;
      }
    }
    return {
      longestWin,
      longestLoss,
      currentStreakType,
      currentStreakValue,
      recent: grouped.slice(-20),
    };
  })();

  const sessionStats = ['Asian', 'London', 'Overlap', 'New York'].map(label => {
    const related = trades.filter(trade => getSessionLabel(trade) === label);
    const wins = related.filter(trade => trade.result === 'Win').length;
    const pnl = related.reduce((sum, trade) => sum + getSafePnL(trade.pnl), 0);
    return {
      label,
      count: related.length,
      pnl: round(pnl),
      winRate: round(related.length > 0 ? (wins / related.length) * 100 : 0, 1),
    };
  });

  const hourlyStats = Array.from({ length: 24 }, (_, hour) => {
    const related = trades.filter(trade => getSastHourFromTrade(trade) === hour);
    const wins = related.filter(trade => trade.result === 'Win').length;
    const pnl = related.reduce((sum, trade) => sum + getSafePnL(trade.pnl), 0);
    return {
      hour,
      label: `${hour}:00`,
      count: related.length,
      pnl: round(pnl),
      winRate: round(related.length > 0 ? (wins / related.length) * 100 : 0, 1),
    };
  });

  const dailyLog = Array.from(
    trades.reduce((map, trade) => {
      const existing = map.get(trade.date) || { pnl: 0, wins: 0, count: 0 };
      existing.pnl += getSafePnL(trade.pnl);
      existing.count += 1;
      if (trade.result === 'Win') existing.wins += 1;
      map.set(trade.date, existing);
      return map;
    }, new Map<string, { pnl: number; wins: number; count: number }>())
  )
    .map(([date, value]) => ({
      date,
      totalPnl: round(value.pnl),
      totalTrades: value.count,
      winRate: round(value.count > 0 ? (value.wins / value.count) * 100 : 0, 1),
    }))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const currentYear = new Date().getFullYear();
  const monthlyPerformance = Array.from({ length: 12 }, (_, monthIndex) => {
    const monthTrades = trades
      .filter(trade => {
        const date = new Date(trade.date);
        return date.getFullYear() === currentYear && date.getMonth() === monthIndex;
      })
      .sort((a, b) => getTradeDateTime(a).getTime() - getTradeDateTime(b).getTime());
    let monthlyRunning = 0;
    let monthlyPeak = 0;
    let maxMonthlyDrawdown = 0;
    monthTrades.forEach(trade => {
      monthlyRunning += getSafePnL(trade.pnl);
      monthlyPeak = Math.max(monthlyPeak, monthlyRunning);
      maxMonthlyDrawdown = Math.min(maxMonthlyDrawdown, monthlyRunning - monthlyPeak);
    });
    return {
      monthIndex,
      month: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][monthIndex],
      trades: monthTrades.length,
      pnl: round(monthTrades.reduce((sum, trade) => sum + getSafePnL(trade.pnl), 0)),
      maxDrawdown: round(maxMonthlyDrawdown),
    };
  }).filter(item => item.trades > 0);

  const currencyStrength = (() => {
    const scores: Record<string, number> = {};
    const currencies = new Set<string>();
    const commonQuotes = ['USD', 'EUR', 'JPY', 'GBP', 'AUD', 'CAD', 'CHF', 'NZD', 'USDT', 'BTC', 'ETH'];
    trades.forEach(trade => {
      let base = '';
      let quote = '';
      const pair = (trade.pair || '').trim().toUpperCase();
      if (!pair) return;
      const separatorMatch = pair.match(/^([A-Z0-9]+)[\/\-\s]([A-Z0-9]+)$/);
      if (separatorMatch) {
        base = separatorMatch[1];
        quote = separatorMatch[2];
      } else if (pair.length === 6) {
        base = pair.slice(0, 3);
        quote = pair.slice(3, 6);
      } else {
        for (const commonQuote of commonQuotes) {
          if (pair.endsWith(commonQuote) && pair.length > commonQuote.length) {
            quote = commonQuote;
            base = pair.slice(0, pair.length - commonQuote.length);
            break;
          }
        }
      }
      if (!base || !quote) return;
      currencies.add(base);
      currencies.add(quote);
      scores[base] = scores[base] || 0;
      scores[quote] = scores[quote] || 0;
      if ((trade.direction || '').toLowerCase() === 'long') {
        scores[base] += getSafePnL(trade.pnl);
        scores[quote] -= getSafePnL(trade.pnl);
      } else {
        scores[base] -= getSafePnL(trade.pnl);
        scores[quote] += getSafePnL(trade.pnl);
      }
    });
    const values = Object.values(scores);
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 0;
    const range = max - min;
    return Array.from(currencies).map(currency => ({
      currency,
      rawScore: round(scores[currency] || 0),
      normalizedStrength: round(range === 0 ? 5 : (((scores[currency] || 0) - min) / range) * 10, 2),
    })).sort((a, b) => b.normalizedStrength - a.normalizedStrength);
  })();

  const strategyEfficiency = Array.from(
    trades.reduce((map, trade) => {
      (trade.tags || []).forEach(tag => {
        const key = tag.trim();
        if (!key) return;
        const current = map.get(key) || { pnl: 0, count: 0, wins: 0 };
        current.pnl += getSafePnL(trade.pnl);
        current.count += 1;
        if (trade.result === 'Win') current.wins += 1;
        map.set(key, current);
      });
      return map;
    }, new Map<string, { pnl: number; count: number; wins: number }>())
  )
    .map(([name, value]) => ({
      name,
      trades: value.count,
      pnl: round(value.pnl),
      winRate: round(value.count > 0 ? (value.wins / value.count) * 100 : 0, 1),
      avgPnl: round(value.count > 0 ? value.pnl / value.count : 0),
      efficiencyScore: round((value.count > 0 ? (value.wins / value.count) * 100 : 0) * (value.pnl > 0 ? 1 : 0.5), 1),
    }))
    .sort((a, b) => b.pnl - a.pnl);

  const performanceMatrix = pairStats.map(symbol => ({
    symbol: symbol.pair,
    months: Array.from({ length: 12 }, (_, monthIndex) => {
      const pnl = trades
        .filter(trade => new Date(trade.date).getFullYear() === currentYear && new Date(trade.date).getMonth() === monthIndex && trade.pair.toUpperCase() === symbol.pair)
        .reduce((sum, trade) => sum + getSafePnL(trade.pnl), 0);
      return round(pnl);
    }),
  }));

  const comparisonLeaders = {
    symbols: pairStats.slice(0, 5),
    strategies: strategyEfficiency.slice(0, 5),
    sessions: [...sessionStats].sort((a, b) => b.pnl - a.pnl),
  };

  return {
    generatedAt: new Date().toISOString(),
    currencySymbol,
    availableAnalyticsTabs: ['overview', 'equity', 'trades', 'psychology', 'time', 'advanced', 'comparison', 'reports', 'session'],
    availableAnalyticsWidgets: [
      'Win Rate',
      'Profit Factor',
      'Gross Profit',
      'Gross Loss',
      'Risk/Reward',
      'Equity Curve',
      'Drawdown Over Time',
      'Trade Momentum',
      'Symbol Performance',
      'Largest Win/Loss',
      'Monthly P&L vs Maximum Drawdown',
      'Currency Strength',
      'Trade Exit Analysis',
      'Outcome Distribution',
      'Discipline Score',
      'P/L by Mindset',
      'P/L by Plan Adherence',
      'Pair Distribution Treemap',
      'Strategy Efficiency',
      'Performance Matrix',
      'Execution Performance Table',
      'Comparison View',
      'Performance By Session',
    ],
    overview: {
      totalTrades: stats.totalTrades,
      netProfit: round(stats.netProfit),
      grossProfit: round(stats.grossProfit),
      grossLoss: round(stats.grossLoss),
      winRate: round(stats.winRate, 1),
      profitFactor: round(stats.profitFactor, 2),
      avgWin: round(stats.avgWin),
      avgLoss: round(stats.avgLoss),
      rrRatio: round(stats.rrRatio, 2),
      bestPair: stats.bestPair ? { symbol: stats.bestPair.symbol, pnl: round(stats.bestPair.pnl) } : null,
      worstPair: stats.worstPair ? { symbol: stats.worstPair.symbol, pnl: round(stats.worstPair.pnl) } : null,
    },
    equity: {
      startingBalance: round(effectiveInitialBalance),
      currentBalance,
      currentEquityFromSession: eaSession?.data?.account?.equity ?? null,
      equityCurve,
      maxDrawdownPercent: round(maxDrawdownPercent, 2),
      monthlyPerformance,
    },
    trades: {
      pairPerformance: pairStats,
      symbolPerformance,
      pairDistribution: pairStats.map(({ pair, pnl, trades: tradeCount }) => ({ pair, pnl, trades: tradeCount })),
      largestWinTrade: largestWinTrade ? { id: largestWinTrade.id, pair: largestWinTrade.pair, pnl: round(getSafePnL(largestWinTrade.pnl)), date: largestWinTrade.date } : null,
      largestLossTrade: largestLossTrade ? { id: largestLossTrade.id, pair: largestLossTrade.pair, pnl: round(getSafePnL(largestLossTrade.pnl)), date: largestLossTrade.date } : null,
      outcomeDistribution,
      exitAnalysis,
      executionPerformance: [...trades]
        .sort((a, b) => getTradeDateTime(a).getTime() - getTradeDateTime(b).getTime())
        .slice(0, 15)
        .map(trade => ({
          id: trade.id,
          pair: trade.pair,
          date: trade.date,
          entryComment: stripHtml(trade.notes),
          exitComment: stripHtml(trade.exitComment),
          returnPercent: round(effectiveInitialBalance > 0 ? (getSafePnL(trade.pnl) / effectiveInitialBalance) * 100 : 0, 3),
        })),
    },
    psychology: {
      disciplineScore,
      momentum,
      plByMindset: mindsetPerformance,
      plByPlanAdherence: planAdherence,
      psychologyInsights: {
        bestMindset: [...mindsetPerformance].sort((a, b) => b.net - a.net)[0]?.label || 'Neutral',
        adherenceLevel: disciplineScore.score >= 70 ? 'High' : disciplineScore.score >= 40 ? 'Medium' : 'Low',
      },
    },
    time: {
      sessions: sessionStats,
      hourly: hourlyStats,
      dailyLog,
      currencyStrength,
    },
    advanced: {
      strategyEfficiency,
      performanceMatrix,
    },
    comparison: comparisonLeaders,
    reports: {
      reportWidgetsBackedBySnapshot: [
        'equityCurve',
        'drawdown',
        'symbolPerformance',
        'largestWinLoss',
        'tradeExit',
        'outcomeDist',
        'streakMomentum',
        'tiltScore',
        'plMindset',
        'plAdherence',
        'monthlyPerformance',
        'currencyStrength',
        'riskReward',
      ],
    },
    dailyBias: dailyBias.map(item => ({
      date: item.date,
      bias: item.bias,
      notes: item.notes || '',
      actualOutcome: item.actualOutcome || null,
    })),
    recentTrades: [...trades].slice(-30).map(trade => ({
      id: trade.ticketId || trade.id,
      date: trade.date,
      time: trade.time,
      pair: trade.pair,
      session: trade.session,
      result: trade.result,
      pnl: round(getSafePnL(trade.pnl)),
      rr: round(trade.rr || 0, 2),
      mindset: trade.mindset || 'Neutral',
      adherence: trade.planAdherence || 'No Plan',
      tags: trade.tags || [],
      notes: trade.notes || '',
      exitComment: trade.exitComment || '',
    })),
  };
};
