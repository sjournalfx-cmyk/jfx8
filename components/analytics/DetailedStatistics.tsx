
import React from 'react';
import { UserProfile } from '../../types';

interface DetailedStatisticsProps {
  stats: any;
  userProfile: UserProfile;
  isDarkMode: boolean;
}

export const DetailedStatistics: React.FC<DetailedStatisticsProps> = ({ stats, userProfile, isDarkMode }) => {
  const currencySymbol = userProfile?.currencySymbol || '$';

  const formatCurrency = (val: number) => {
    return `${val < 0 ? '-' : ''}${currencySymbol}${Math.abs(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatHoldTime = (minutes: number) => {
    if (minutes === 0 || isNaN(minutes)) return 'N/A';
    if (minutes < 60) return `${Math.round(minutes)} minutes`;
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours} hour${hours > 1 ? 's' : ''}, ${mins} minute${mins !== 1 ? 's' : ''}`;
  };

  const StatRow = ({ label, value, isNegative = false }: { label: string, value: any, isNegative?: boolean }) => (
    <div className={`flex justify-between items-center py-2.5 px-4 ${isDarkMode ? 'hover:bg-black/50' : 'hover:bg-slate-50'} border-b ${isDarkMode ? 'border-zinc-800' : 'border-slate-100'}`}>
      <span className={`text-sm font-medium ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>{label}</span>
      <span className={`text-sm font-bold ${isDarkMode ? 'text-zinc-200' : 'text-slate-900'} ${isNegative ? 'text-rose-500' : ''}`}>
        {value}
      </span>
    </div>
  );

  const leftColumn = [
    { label: 'Total P&L', value: formatCurrency(stats.netProfit), isNegative: stats.netProfit < 0 },
    { label: 'Average Daily Volume', value: (stats.totalTrades / (stats.totalTradingDays || 1)).toFixed(2) },
    { label: 'Average Winning Trade', value: formatCurrency(stats.avgWin) },
    { label: 'Average Losing Trade', value: formatCurrency(-stats.avgLoss), isNegative: true },
    { label: 'Total Number of Trades', value: stats.totalTrades },
    { label: 'Number of Winning Trades', value: stats.numWins },
    { label: 'Number of Losing Trades', value: stats.numLosses },
    { label: 'Number of Break Even Trades', value: stats.numBE },
    { label: 'Max Consecutive Wins', value: stats.maxConsecutiveWins },
    { label: 'Max Consecutive Losses', value: stats.maxConsecutiveLosses },
    { label: 'Total Commissions', value: formatCurrency(stats.totalCommissions) },
    { label: 'Total Fees', value: formatCurrency(stats.totalFees) },
    { label: 'Total Swap', value: formatCurrency(stats.totalSwap) },
    { label: 'Largest Profit', value: formatCurrency(stats.largestProfit) },
    { label: 'Largest Loss', value: formatCurrency(stats.largestLoss), isNegative: true },
    { label: 'Average Hold Time (All Trades)', value: formatHoldTime(stats.avgHoldTime) },
    { label: 'Average Hold Time (Winning Trades)', value: formatHoldTime(stats.avgWinHoldTime) },
    { label: 'Average Hold Time (Losing Trades)', value: formatHoldTime(stats.avgLossHoldTime) },
    { label: 'Average Hold Time (Scratch Trades)', value: formatHoldTime(stats.avgBEHoldTime) },
    { label: 'Average Trade P&L', value: formatCurrency(stats.avgTradePnL), isNegative: stats.avgTradePnL < 0 },
    { label: 'Profit Factor', value: stats.profitFactor.toFixed(2) },
  ];

  const rightColumn = [
    { label: 'Open trades', value: stats.openTrades },
    { label: 'Total Trading Days', value: stats.totalTradingDays },
    { label: 'Winning Days', value: stats.winningDays },
    { label: 'Losing Days', value: stats.losingDays },
    { label: 'Breakeven days', value: stats.breakevenDays },
    { label: 'Logged Days', value: stats.totalTradingDays },
    { label: 'Max Consecutive Winning Days', value: stats.maxConsecutiveWinDays },
    { label: 'Max Consecutive Losing Days', value: stats.maxConsecutiveLossDays },
    { label: 'Average Daily P&L', value: formatCurrency(stats.avgDailyPnL), isNegative: stats.avgDailyPnL < 0 },
    { label: 'Average Winning Day P&L', value: formatCurrency(stats.avgWinningDay) },
    { label: 'Average Losing Day P&L', value: formatCurrency(-stats.avgLosingDay), isNegative: true },
    { label: 'Largest Profitable Day (Profits)', value: formatCurrency(stats.largestWinDay) },
    { label: 'Largest Losing Day (Losses)', value: formatCurrency(stats.largestLossDay), isNegative: true },
    { label: 'Average Planned R-Multiple', value: `${stats.avgPlannedR.toFixed(2)}R` },
    { label: 'Average Realized R-Multiple', value: stats.validRealizedRCount > 0 ? `${stats.avgRealizedR.toFixed(2)}R` : 'N/A — No Stop Loss set' },
    { label: 'Trade Expectancy', value: formatCurrency(stats.tradeExpectancy), isNegative: stats.tradeExpectancy < 0 },
    { label: 'Max Drawdown', value: formatCurrency(-stats.maxDrawdown), isNegative: true },
    { label: 'Max Drawdown, %', value: stats.maxDrawdown > 0 ? `-${((stats.maxDrawdown / (userProfile.initialBalance || 100000)) * 100).toFixed(2)}%` : '0.00%' },
    { label: 'Average Drawdown', value: formatCurrency(-stats.avgDrawdown), isNegative: true },
    { label: 'Average Drawdown, %', value: stats.avgDrawdown > 0 ? `-${((stats.avgDrawdown / (userProfile.initialBalance || 100000)) * 100).toFixed(2)}%` : '0.00%' },
  ];

  return (
    <div className={`grid grid-cols-1 md:grid-cols-2 gap-8 w-full ${isDarkMode ? 'bg-black' : 'bg-white'} py-8 px-0 rounded-[32px] ${isDarkMode ? 'shadow-2xl' : 'shadow-xl'}`}>
      {/* Currency badge so trader knows what denomination all values are in */}
      <div className="col-span-full flex items-center gap-2 mb-2">
        <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] ${isDarkMode ? 'bg-white/[0.05] text-zinc-400' : 'bg-slate-100 text-slate-500'}`}>
          All values in {userProfile.currency || 'USD'} ({currencySymbol})
        </span>
      </div>
      <div className="space-y-0.5">
        {leftColumn.map((row, i) => (
          <StatRow key={i} label={row.label} value={row.value} isNegative={row.isNegative} />
        ))}
      </div>
      <div className="space-y-0.5">
        {rightColumn.map((row, i) => (
          <StatRow key={i} label={row.label} value={row.value} isNegative={row.isNegative} />
        ))}
      </div>
    </div>
  );
};
