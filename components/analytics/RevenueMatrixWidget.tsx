import React, { useState, useMemo } from 'react';
import { Trade } from '../../types';
import { HelpCircle, BarChart2 } from 'lucide-react';
import { Tooltip } from '../ui/Tooltip';

interface RevenueMatrixWidgetProps {
  trades?: Trade[];
  isDarkMode: boolean;
  currencySymbol?: string;
  onInfoClick?: () => void;
}

interface MatrixPeriodData {
  month: string;
  year: number;
  grossProfit: number;
  grossLoss: number;
  netPnL: number;
  grossProfitStr: string;
  grossLossStr: string;
  profitFactor: string;
  // Sub-bars: 3 sub-columns per period (left, middle, right)
  subBars: { profitBlocks: number; lossBlocks: number }[];
}

const DEFAULT_DEMO_DATA: { month: string; year: number; grossProfit: number; grossLoss: number }[] = [
  { month: 'JAN', year: 2025, grossProfit: 12400, grossLoss: 5100 },
  { month: 'FEB', year: 2025, grossProfit: 22800, grossLoss: 12400 },
  { month: 'MAR', year: 2025, grossProfit: 18500, grossLoss: 8200 },
  { month: 'APR', year: 2025, grossProfit: 14200, grossLoss: 6100 },
  { month: 'MAY', year: 2025, grossProfit: 28600, grossLoss: 18400 },
  { month: 'JUN', year: 2025, grossProfit: 22100, grossLoss: 16200 },
  { month: 'JUL', year: 2025, grossProfit: 15400, grossLoss: 7300 },
  { month: 'AUG', year: 2025, grossProfit: 19800, grossLoss: 9500 },
  { month: 'SEP', year: 2025, grossProfit: 21300, grossLoss: 11200 },
  { month: 'OCT', year: 2025, grossProfit: 17600, grossLoss: 10400 },
  { month: 'NOV', year: 2025, grossProfit: 11200, grossLoss: 5300 },
  { month: 'DEC', year: 2025, grossProfit: 20400, grossLoss: 10100 }
];

export function RevenueMatrixWidget({
  trades = [],
  isDarkMode,
  currencySymbol = '$',
  onInfoClick
}: RevenueMatrixWidgetProps) {
  const [period, setPeriod] = useState<'Weekly' | 'Monthly' | 'Yearly'>('Monthly');
  const [activeMonthIndex, setActiveMonthIndex] = useState<number>(5); // Default JUN (index 5)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const MAX_BLOCKS = 18;

  const hasNoData = useMemo(() => {
    return trades.filter((t) => t.result !== 'Pending' && t.pnl !== undefined).length === 0;
  }, [trades]);

  // Process completed trades into 12 periods
  const matrixData: MatrixPeriodData[] = useMemo(() => {
    const closedTrades = trades.filter((t) => t.result !== 'Pending' && t.pnl !== undefined);

    if (closedTrades.length === 0) {
      return [];
    }

    // Group real trades by selected period (Monthly / Weekly / Yearly)
    const periodsMap: Record<string, { month: string; year: number; grossProfit: number; grossLoss: number }> = {};

    closedTrades.forEach((trade) => {
      const dateStr = trade.date || trade.openTime || '';
      const date = dateStr ? new Date(dateStr) : new Date();
      const yr = date.getFullYear() || new Date().getFullYear();
      let key = '';
      let label = '';

      if (period === 'Weekly') {
        const firstDayOfYear = new Date(yr, 0, 1);
        const pastDays = Math.floor((date.getTime() - firstDayOfYear.getTime()) / 86400000);
        const weekNum = Math.ceil((pastDays + firstDayOfYear.getDay() + 1) / 7);
        key = `W${weekNum}-${yr}`;
        label = `W${weekNum}`;
      } else if (period === 'Yearly') {
        key = `${yr}`;
        label = `${yr}`;
      } else {
        // Monthly default
        const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
        const mName = monthNames[date.getMonth()];
        key = `${mName}-${yr}`;
        label = mName;
      }

      if (!periodsMap[key]) {
        periodsMap[key] = { month: label, year: yr, grossProfit: 0, grossLoss: 0 };
      }

      const pnl = Number(trade.pnl || 0);
      if (pnl > 0) {
        periodsMap[key].grossProfit += pnl;
      } else if (pnl < 0) {
        periodsMap[key].grossLoss += Math.abs(pnl);
      }
    });

    let rawPeriodList = Object.values(periodsMap);

    // Fill to 12 periods if less than 12
    if (rawPeriodList.length < 12) {
      const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      const currentYear = new Date().getFullYear();

      const existingMonths = new Set(rawPeriodList.map((p) => p.month));
      monthNames.forEach((m) => {
        if (!existingMonths.has(m) && rawPeriodList.length < 12) {
          rawPeriodList.push({ month: m, year: currentYear, grossProfit: 0, grossLoss: 0 });
        }
      });
    }

    rawPeriodList = rawPeriodList.slice(0, 12);
    const maxVal = Math.max(...rawPeriodList.map((d) => Math.max(d.grossProfit, d.grossLoss)), 1000);

    return rawPeriodList.map((d) => {
      const netPnL = d.grossProfit - d.grossLoss;
      const profitBlocks = d.grossProfit > 0 ? Math.min(MAX_BLOCKS, Math.max(1, Math.round((d.grossProfit / maxVal) * MAX_BLOCKS))) : 0;
      const lossBlocks = d.grossLoss > 0 ? Math.min(MAX_BLOCKS, Math.max(1, Math.round((d.grossLoss / maxVal) * MAX_BLOCKS))) : 0;

      return {
        month: d.month,
        year: d.year,
        grossProfit: d.grossProfit,
        grossLoss: d.grossLoss,
        netPnL,
        grossProfitStr: `+${currencySymbol}${d.grossProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
        grossLossStr: `-${currencySymbol}${d.grossLoss.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
        profitFactor: d.grossLoss > 0 ? (d.grossProfit / d.grossLoss).toFixed(2) : d.grossProfit > 0 ? 'INF' : '0.00',
        subBars: [
          { profitBlocks, lossBlocks: 0 }, // Dual bar 1: Gross Profit
          { profitBlocks: 0, lossBlocks }  // Dual bar 2: Gross Loss
        ]
      };
    });
  }, [trades, period, currencySymbol]);

  const selectedIndex = hasNoData ? 0 : Math.min(hoveredIndex !== null ? hoveredIndex : activeMonthIndex, Math.max(0, matrixData.length - 1));
  const currentPeriodData = matrixData[selectedIndex] || { month: '—', year: new Date().getFullYear(), grossProfit: 0, grossLoss: 0, netPnL: 0, grossProfitStr: `+${currencySymbol}0`, grossLossStr: `-${currencySymbol}0`, profitFactor: '0.00', subBars: [{ profitBlocks: 0, lossBlocks: 0 }, { profitBlocks: 0, lossBlocks: 0 }] } as MatrixPeriodData;

  // Overall Total Metrics
  const totalGrossProfit = useMemo(() => matrixData.reduce((acc, curr) => acc + curr.grossProfit, 0), [matrixData]);
  const totalGrossLoss = useMemo(() => matrixData.reduce((acc, curr) => acc + curr.grossLoss, 0), [matrixData]);
  const totalNetPnL = totalGrossProfit - totalGrossLoss;

  const maxTotalVolume = useMemo(() => Math.max(...matrixData.map((d) => Math.max(d.grossProfit, d.grossLoss)), 1000), [matrixData]);

  return (
    <div
      className="p-5 md:p-6 rounded-3xl border-0 flex flex-col w-full overflow-visible relative bg-[#0a0a0a] text-white"
    >
      {/* Top Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 shrink-0">
        {/* Title Group */}
        <div className="flex items-center gap-2.5">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] font-semibold tracking-tight text-left">Gross Gains vs Gross Losses</h3>
              <Tooltip content="Gross gains from winning trades vs gross losses from losing trades over time." isDarkMode={isDarkMode} onInfoClick={onInfoClick}>
                <HelpCircle size={14} className="opacity-40 cursor-help hover:opacity-100" />
              </Tooltip>
            </div>
            <p className="text-[10px] uppercase font-black tracking-widest opacity-40">Monthly Profitability Matrix</p>
          </div>
        </div>

        {/* Legend + Period Selector + Net P&L Badge */}
        <div className="flex items-center gap-4 flex-wrap justify-end">
          {/* Net P&L Summary Pill */}
          <div className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${
            totalNetPnL >= 0 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'
          }`}>
            <span>Net P&L:</span>
            <span>{totalNetPnL >= 0 ? '+' : '-'}{currencySymbol}{Math.abs(totalNetPnL).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-sm ${isDarkMode ? 'bg-emerald-500' : 'bg-emerald-600'}`} />
              <span className={`text-[10px] font-bold tracking-wider uppercase ${isDarkMode ? 'text-emerald-400/90' : 'text-emerald-700'}`}>
                Gross Profit
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-sm ${isDarkMode ? 'bg-rose-500' : 'bg-rose-600'}`} />
              <span className={`text-[10px] font-bold tracking-wider uppercase ${isDarkMode ? 'text-rose-400/90' : 'text-rose-700'}`}>
                Gross Loss
              </span>
            </div>
          </div>

          {/* Period Selector Toggle */}
          <div
            className={`flex items-center gap-1 p-1 rounded-full border ${
              isDarkMode
                ? 'bg-zinc-900/80 border-zinc-800'
                : 'bg-slate-100/80 border-slate-200/60'
            }`}
          >
            {(['Weekly', 'Monthly', 'Yearly'] as const).map((item) => (
              <button
                key={item}
                onClick={() => setPeriod(item)}
                className={`px-3 py-1 text-xs font-bold rounded-full transition-all duration-200 ${
                  period === item
                    ? isDarkMode
                      ? 'bg-zinc-800 text-white shadow-sm'
                      : 'bg-white text-slate-900 shadow-sm'
                    : isDarkMode
                    ? 'text-zinc-500 hover:text-zinc-300'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      </div>

      {hasNoData ? (
        <div className={`flex flex-col items-center justify-center py-16 px-6 rounded-2xl border border-dashed text-center ${isDarkMode ? 'border-zinc-800 bg-zinc-900/30 text-zinc-400' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${isDarkMode ? 'bg-zinc-900 text-zinc-500' : 'bg-slate-100 text-slate-400'}`}>
            <BarChart2 size={22} />
          </div>
          <p className="text-sm font-black uppercase tracking-widest">No Data Available</p>
          <p className="text-xs mt-1.5 max-w-[320px] leading-relaxed opacity-70">No closed trades yet. Log a trade to see your Gross Gains vs Gross Losses matrix here.</p>
        </div>
      ) : (
        <>
          {/* Dedicated Active Period Info Header Strip (Replaces Floating Tooltip) */}
          <div
            className={`w-full mb-4 px-4 py-2.5 rounded-2xl border flex flex-wrap items-center justify-between gap-3 transition-colors ${
          isDarkMode
            ? 'bg-zinc-900/50 border-zinc-800/80 text-zinc-200'
            : 'bg-slate-50 border-slate-200 text-slate-800'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-black uppercase tracking-wider text-emerald-500">
            {currentPeriodData.month} {currentPeriodData.year}
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded-md bg-zinc-800/60 text-zinc-400 font-mono font-bold">
            PF: {currentPeriodData.profitFactor}
          </span>
        </div>

        <div className="flex items-center gap-5 text-xs flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium opacity-60">Gross Profit:</span>
            <span className="font-extrabold text-emerald-500">{currentPeriodData.grossProfitStr}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium opacity-60">Gross Loss:</span>
            <span className="font-extrabold text-rose-500">{currentPeriodData.grossLossStr}</span>
          </div>
          <div className="flex items-center gap-1.5 pl-2 border-l border-zinc-700/40">
            <span className="text-[11px] font-medium opacity-60">Period Net P&L:</span>
            <span className={`font-black ${currentPeriodData.netPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {currentPeriodData.netPnL >= 0 ? '+' : '-'}{currencySymbol}{Math.abs(currentPeriodData.netPnL).toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      {/* Chart Matrix Container */}
      <div className="relative flex flex-col w-full flex-1 justify-end pt-1 pb-1 overflow-visible">
        <div className="w-full relative flex-1 flex flex-col justify-end">
          {/* Matrix Grid Area */}
          <div className="flex w-full items-stretch flex-1">
            {/* Y-Axis Labels Column - Aligned 1:1 with the 18 blocks */}
            <div className="flex flex-col-reverse justify-between pr-3 shrink-0 text-right select-none gap-[1.5px] pb-1">
              {(() => {
                // Pre-compute labels and deduplicate so small datasets don't repeat values
                const rawLabelMap: Record<number, string> = {
                  0: '0k',
                  5: `${((maxTotalVolume * 0.3) / 1000).toFixed(0)}k`,
                  11: `${((maxTotalVolume * 0.6) / 1000).toFixed(0)}k`,
                  17: `${(maxTotalVolume / 1000).toFixed(0)}k`
                };
                const seenLabels = new Set<string>();
                const dedupedLabelMap: Record<number, string> = {};
                // Walk from bottom (block 0) to top (block 17) to keep first occurrence only
                [0, 5, 11, 17].forEach((idx) => {
                  const val = rawLabelMap[idx];
                  if (!seenLabels.has(val)) {
                    seenLabels.add(val);
                    dedupedLabelMap[idx] = val;
                  }
                });

                return Array.from({ length: MAX_BLOCKS }).map((_, blockIdx) => {
                  const label = dedupedLabelMap[blockIdx];
                  return (
                    <div
                      key={blockIdx}
                      className="h-[9px] sm:h-[10px] md:h-[11px] flex items-center justify-end text-[9px] sm:text-[10px]"
                    >
                      {label !== undefined ? (
                        <div
                          className={`font-bold flex items-center justify-end gap-1.5 ${
                            isDarkMode ? 'text-zinc-500' : 'text-slate-400'
                          }`}
                        >
                          <span>{label}</span>
                          <div
                            className={`w-1 h-1 rounded-full ${
                              isDarkMode ? 'bg-zinc-700' : 'bg-slate-300'
                            }`}
                          />
                        </div>
                      ) : null}
                    </div>
                  );
                });
              })()}
            </div>

            {/* Flat 24-Column Responsive Matrix Grid (2 columns per period for 12 periods) */}
            <div className="flex-1 grid grid-cols-[repeat(24,minmax(0,1fr))] gap-x-[3px] gap-y-[1.5px] sm:gap-y-[2px] md:gap-y-[3px] w-full relative items-end">
              {Array.from({ length: 24 }).map((_, colIdx) => {
                const mIdx = Math.floor(colIdx / 2);
                const isLossColumn = colIdx % 2 === 1;
                const data = matrixData[mIdx] || matrixData[0];
                const isSelected = selectedIndex === mIdx;

                const subBar = data.subBars[isLossColumn ? 1 : 0] || { profitBlocks: 0, lossBlocks: 0 };

                return (
                  <div
                    key={colIdx}
                    onMouseEnter={() => setHoveredIndex(mIdx)}
                    onMouseLeave={() => setHoveredIndex(null)}
                    onClick={() => setActiveMonthIndex(mIdx)}
                    className={`relative flex flex-col justify-end items-center h-full cursor-pointer group pb-0.5 w-full transition-opacity ${
                      isSelected ? 'opacity-100' : 'opacity-70 hover:opacity-90'
                    }`}
                  >
                    {/* Active Period Indicator Dot on top of profit column */}
                    {isSelected && !isLossColumn && (
                      <div
                        className={`absolute -top-3 left-full -translate-x-1/2 z-20 w-2 h-2 rounded-full border shadow-md ${
                          isDarkMode
                            ? 'bg-emerald-400 border-black'
                            : 'bg-emerald-600 border-white'
                        }`}
                      />
                    )}

                    {/* Sub-bars (Matrix Grid columns for this period) */}
                    <div className="flex flex-col-reverse gap-[1.5px] items-center w-full z-10">
                      {Array.from({ length: MAX_BLOCKS }).map((_, blockIdx) => {
                        const isProfitBlock = !isLossColumn && blockIdx < subBar.profitBlocks;
                        const isLossBlock = isLossColumn && blockIdx < subBar.lossBlocks;

                        let tileColorClass = "";

                        if (isProfitBlock) {
                          tileColorClass = isDarkMode
                            ? 'bg-emerald-500 shadow-sm shadow-emerald-500/20'
                            : 'bg-emerald-600 shadow-sm shadow-emerald-600/20';
                        } else if (isLossBlock) {
                          tileColorClass = isDarkMode
                            ? 'bg-rose-500 shadow-sm shadow-rose-500/20'
                            : 'bg-rose-600 shadow-sm shadow-rose-600/20';
                        } else {
                          // EMPTY SQUARES (Matrix Grid background tiles)
                          tileColorClass = isDarkMode
                            ? 'bg-zinc-950/20 border border-zinc-900/30'
                            : 'bg-slate-100/40 border border-slate-200/20';
                        }

                        return (
                          <div
                            key={blockIdx}
                            style={{
                              backgroundColor: isProfitBlock
                                ? (isDarkMode ? '#10b981' : '#059669')
                                : isLossBlock
                                ? (isDarkMode ? '#f43f5e' : '#e11d48')
                                : undefined
                            }}
                            className={`w-full h-[9px] sm:h-[10px] md:h-[11px] rounded-[1px] transition-all duration-150 ${tileColorClass}`}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* X-Axis Month / Period Labels */}
          <div className="flex w-full pt-2">
            <div className="w-6 shrink-0 pr-2" /> {/* Spacer matching Y axis label width */}
            <div className="flex-1 grid grid-cols-[repeat(12,minmax(0,1fr))] text-center w-full">
              {matrixData.map((data, mIdx) => {
                const isSelected = selectedIndex === mIdx;

                return (
                  <div key={mIdx} className="flex justify-center items-center">
                    <button
                      onClick={() => setActiveMonthIndex(mIdx)}
                      onMouseEnter={() => setHoveredIndex(mIdx)}
                      onMouseLeave={() => setHoveredIndex(null)}
                      className={`text-[10px] uppercase tracking-wider font-bold transition-colors whitespace-nowrap ${
                        isSelected
                          ? isDarkMode
                            ? 'text-emerald-400 font-black scale-105'
                            : 'text-emerald-700 font-black scale-105'
                          : isDarkMode
                          ? 'text-zinc-500 hover:text-zinc-300'
                          : 'text-slate-400 hover:text-slate-700'
                      }`}
                    >
                      {data.month}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
        </>
      )}
    </div>
  );
}


