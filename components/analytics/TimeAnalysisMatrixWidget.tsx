
import React, { useMemo, useState } from 'react';
import { Trade } from '../../types';
import { Clock, TrendingUp, TrendingDown, AlertCircle, HelpCircle } from 'lucide-react';
import { clsx } from 'clsx';
import { getTimezoneLabel, getSastHourFromTrade, getSastWeekdayFromDate } from '../../lib/timeUtils';
import { Tooltip } from '../ui/Tooltip';

interface TimeAnalysisMatrixProps {
  trades: Trade[];
  isDarkMode: boolean;
  currencySymbol: string;
}

export const TimeAnalysisMatrixWidget: React.FC<TimeAnalysisMatrixProps> = ({ trades, isDarkMode, currencySymbol }) => {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const [hoveredCell, setHoveredCell] = useState<{ day: string; hour: number; x: number; y: number } | null>(null);

  const matrixData = useMemo(() => {
    const data: Record<string, Record<number, { pnl: number, count: number, wins: number }>> = {};

    days.forEach(d => {
      data[d] = {};
      hours.forEach(h => {
        data[d][h] = { pnl: 0, count: 0, wins: 0 };
      });
    });

    trades.forEach(t => {
      const dayName = getSastWeekdayFromDate(t.date);
      const hour = getSastHourFromTrade(t);

      if (dayName && hour !== null && data[dayName] && data[dayName][hour] !== undefined) {
        data[dayName][hour].pnl += t.pnl;
        data[dayName][hour].count += 1;
        if (t.result === 'Win') data[dayName][hour].wins += 1;
      }
    });

    return data;
  }, [trades]);

  const stats = useMemo(() => {
    let maxPnl = -Infinity;
    let minPnl = Infinity;
    let maxDay = '';
    let maxHour = 0;
    let minDay = '';
    let minHour = 0;
    let totalTrades = 0;
    let totalPnl = 0;

    days.forEach(d => {
      hours.forEach(h => {
        const cell = matrixData[d][h];
        if (cell.count > 0) {
          totalTrades += cell.count;
          totalPnl += cell.pnl;
          if (cell.pnl > maxPnl) {
            maxPnl = cell.pnl;
            maxDay = d;
            maxHour = h;
          }
          if (cell.pnl < minPnl) {
            minPnl = cell.pnl;
            minDay = d;
            minHour = h;
          }
        }
      });
    });

    return { maxPnl, minPnl, maxDay, maxHour, minDay, minHour, totalTrades, totalPnl };
  }, [matrixData]);

  const getBgColor = (val: number, count: number, day: string, hour: number) => {
    if (count === 0) return isDarkMode ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.03)';
    if (val === 0) return isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';

    const isBest = stats.maxDay === day && stats.maxHour === hour && stats.maxPnl > 0;
    const isWorst = stats.minDay === day && stats.minHour === hour && stats.minPnl < 0;

    if (val > 0) {
      const opacity = Math.min(0.85, 0.15 + (val / Math.max(Math.abs(stats.maxPnl), 500)) * 0.7);
      return isBest 
        ? `rgba(16, 185, 129, ${opacity})` 
        : `rgba(34, 197, 94, ${opacity})`;
    } else {
      const opacity = Math.min(0.85, 0.15 + (Math.abs(val) / Math.max(Math.abs(stats.minPnl), 500)) * 0.7);
      return isWorst 
        ? `rgba(244, 63, 94, ${opacity})` 
        : `rgba(239, 68, 68, ${opacity})`;
    }
  };

  const getSessionLabel = (hour: number) => {
    if (hour >= 0 && hour < 9) return 'ASIA';
    if (hour >= 9 && hour < 15) return 'LONDON';
    if (hour >= 15 && hour < 18) return 'OVERLAP';
    return 'NY';
  };

  const sessionColors: Record<string, string> = {
    ASIA: 'bg-amber-500/20 text-amber-600 dark:text-amber-400',
    LONDON: 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
    OVERLAP: 'bg-purple-500/20 text-purple-600 dark:text-purple-400',
    NY: 'bg-orange-500/20 text-orange-600 dark:text-orange-400',
  };

  const handleMouseMove = (e: React.MouseEvent, day: string, hour: number) => {
    setHoveredCell({
      day,
      hour,
      x: e.clientX,
      y: e.clientY
    });
  };

  return (
    <div className={`p-6 rounded-3xl border flex flex-col h-full overflow-visible relative ${isDarkMode ? 'bg-black border-zinc-800' : 'bg-white border-slate-200 shadow-md'}`}>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-500">
            <Clock size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold tracking-tight italic uppercase">Time-of-Day Performance</h3>
              <Tooltip content="Heatmap showing net P&L for each day-and-hour combination. Green = profitable slot, Red = loss-making slot." isDarkMode={isDarkMode}>
                <HelpCircle size={14} className="opacity-40 cursor-help hover:opacity-100" />
              </Tooltip>
            </div>
            <p className="text-[10px] uppercase font-black tracking-widest opacity-40">Day vs Hour Heatmap</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {stats.totalTrades > 0 && (
            <div className="flex gap-3">
            <div className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${stats.maxPnl > 0 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-zinc-500/10 text-zinc-400'}`}>
              <TrendingUp size={14} />
              <span>{stats.maxDay} {stats.maxHour}:00</span>
            </div>
            <div className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${stats.minPnl < 0 ? 'bg-rose-500/10 text-rose-500' : 'bg-zinc-500/10 text-zinc-400'}`}>
              <TrendingDown size={14} />
              <span>{stats.minDay} {stats.minHour}:00</span>
            </div>
            </div>
          )}
          <div className="text-[10px] font-black uppercase tracking-widest opacity-50 text-right">
            Timezone: {getTimezoneLabel()}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-x-auto custom-scrollbar pb-2">
        <div className="min-w-[900px]">
          <div className="flex mb-3 ml-14">
            {hours.map(h => (
              <div key={h} className="flex-1 text-center text-[7px] font-bold opacity-35 uppercase tracking-wider">
                {h % 3 === 0 ? h.toString().padStart(2, '0') : ''}
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            {days.map(day => (
              <div key={day} className="flex items-center">
                <div className="w-14 text-[11px] font-bold uppercase opacity-50 text-right pr-3">{day}</div>
                <div className="flex-1 flex gap-[2px] h-10">
                  {hours.map(hour => {
                    const cell = matrixData[day][hour];
                    return (
                      <div
                        key={hour}
                        className={`flex-1 rounded-sm hover:ring-2 hover:ring-white/30 cursor-pointer relative z-10`}
                        style={{ 
                          backgroundColor: getBgColor(cell.pnl, cell.count, day, hour),
                          minWidth: '18px'
                        }}
                        onMouseEnter={(e) => handleMouseMove(e, day, hour)}
                        onMouseMove={(e) => handleMouseMove(e, day, hour)}
                        onMouseLeave={() => setHoveredCell(null)}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="flex mt-3 ml-14">
            {hours.map(h => (
              <div key={h} className="flex-1 text-center">
                <span className={`text-[6px] font-bold uppercase px-1 py-0.5 rounded ${sessionColors[getSessionLabel(h)]}`}>
                  {getSessionLabel(h)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {hoveredCell && matrixData[hoveredCell.day][hoveredCell.hour].count > 0 && (() => {
          const cell = matrixData[hoveredCell.day][hoveredCell.hour];
          const avgPnl = cell.pnl / cell.count;
          return (
            <div 
              className="fixed pointer-events-none z-[9999] p-4 rounded-2xl border shadow-2xl backdrop-blur-xl"
              style={{ 
                left: hoveredCell.x + 20, 
                top: hoveredCell.y - 120,
                backgroundColor: isDarkMode ? 'rgba(0, 0, 0, 0.95)' : 'rgba(255, 255, 255, 0.95)',
                borderColor: isDarkMode ? 'rgba(63, 63, 70, 0.5)' : 'rgba(226, 232, 240, 0.8)',
                minWidth: '220px'
              }}
            >
              <div className="flex items-center justify-between mb-3 pb-3 border-b border-zinc-500/10">
                <div className="flex items-center gap-2">
                  <Clock size={14} className="text-indigo-500" />
                  <span className="font-black uppercase tracking-widest text-[10px]">{hoveredCell.day} @ {hoveredCell.hour}:00</span>
                </div>
                <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase ${sessionColors[getSessionLabel(hoveredCell.hour)]}`}>
                  {getSessionLabel(hoveredCell.hour)}
                </span>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-0.5">
                  <span className="text-[8px] font-bold uppercase tracking-widest opacity-40">Net P&L</span>
                  <div className={clsx("text-xs font-black", cell.pnl >= 0 ? "text-emerald-500" : "text-rose-500")}>
                    {cell.pnl >= 0 ? '+' : ''}{currencySymbol}{Math.abs(cell.pnl).toLocaleString()}
                  </div>
                </div>

                <div className="space-y-0.5 text-right">
                  <span className="text-[8px] font-bold uppercase tracking-widest opacity-40">Win Rate</span>
                  <div className="text-xs font-black text-indigo-500">
                    {((cell.wins / cell.count) * 100).toFixed(0)}%
                  </div>
                </div>

                <div className="space-y-0.5">
                  <span className="text-[8px] font-bold uppercase tracking-widest opacity-40">Trades</span>
                  <div className={clsx("text-xs font-black", isDarkMode ? "text-white" : "text-slate-900")}>
                    {cell.count}
                  </div>
                </div>

                <div className="space-y-0.5 text-right">
                  <span className="text-[8px] font-bold uppercase tracking-widest opacity-40">Avg P&L</span>
                  <div className={clsx("text-xs font-black opacity-60", avgPnl >= 0 ? "text-emerald-500" : "text-rose-500")}>
                     {avgPnl >= 0 ? '+' : '-'}{currencySymbol}{Math.abs(avgPnl).toFixed(0)}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 px-2">
        <div className="flex items-center gap-6 text-[10px] font-bold uppercase tracking-wider opacity-50">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm bg-emerald-500/60" />
            <span>Profit</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm bg-rose-500/60" />
            <span>Loss</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm bg-zinc-500/30" />
            <span>No Data</span>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest opacity-25 italic">
          <AlertCircle size={12} />
          <span>Timezone: {getTimezoneLabel()}</span>
        </div>
      </div>
    </div>
  );
};
