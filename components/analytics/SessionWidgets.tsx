
import React, { useMemo } from 'react';
import { Sunrise, Sun, Sunset, Activity, Clock, TrendingUp, TrendingDown, Target, BarChart2, HelpCircle } from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Cell,
  ReferenceLine,
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis
} from 'recharts';
import { Trade } from '../../types';
import { clsx } from 'clsx';
import { ANALYTICS_TIMEZONE_LABEL, getSastHourFromTrade, getSastWeekdayFromDate } from '../../lib/timeUtils';
import { Tooltip as InfoTooltip } from '../ui/Tooltip';

const safePnL = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

interface WidgetProps {
  trades: Trade[];
  isDarkMode: boolean;
  currencySymbol: string;
}

const getSessionIcon = (session: string) => {
  switch (session) {
    case 'Asian': return <Sunrise size={18} className="text-amber-500" />;
    case 'London': return <Sun size={18} className="text-blue-500" />;
    case 'Overlap': return <Activity size={18} className="text-purple-500" />; 
    case 'New York': return <Sunset size={18} className="text-orange-500" />;
    default: return <Clock size={18} className="text-gray-500" />;
  }
};

const getTradeSession = (trade: Trade) => {
  const session = (trade.session && trade.session !== 'Session' ? trade.session : '') || '';
  if (session) return session;

  const hour = getSastHourFromTrade(trade);
  if (hour === null) return 'Unknown';
  if (hour >= 0 && hour < 9) return 'Asian';
  if (hour >= 9 && hour < 15) return 'London';
  if (hour >= 15 && hour < 18) return 'Overlap';
  if (hour >= 18) return 'New York';
  return 'Unknown';
};

const getTradeHour = (trade: Trade) => getSastHourFromTrade(trade);

const calculateHoldMinutes = (trade: Trade) => {
  if (!trade.openTime || !trade.closeTime) return null;

  const start = new Date(trade.openTime).getTime();
  const end = new Date(trade.closeTime).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;

  return (end - start) / (1000 * 60);
};

const formatDuration = (minutes: number) => {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;

  if (hours <= 0) return `${mins}m`;
  return `${hours}h ${String(mins).padStart(2, '0')}m`;
};

const formatPnL = (value: number, currencySymbol: string) => {
  const sign = value >= 0 ? '+' : '-';
  return `${sign}${currencySymbol}${Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
};

const formatPercent = (value: number) => `${value.toFixed(0)}%`;

const formatSignedPnL = (value: number, currencySymbol: string) => {
  const sign = value >= 0 ? '+' : '-';
  return `${sign}${currencySymbol}${Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
};

export const MarketSessionWidget: React.FC<WidgetProps> = ({ trades, isDarkMode, currencySymbol }) => {
  const data = useMemo(() => {
    const stats: Record<string, { pnl: number, wins: number, count: number }> = {
      'Asian': { pnl: 0, wins: 0, count: 0 },
      'London': { pnl: 0, wins: 0, count: 0 },
      'Overlap': { pnl: 0, wins: 0, count: 0 },
      'New York': { pnl: 0, wins: 0, count: 0 },
    };
    
    trades.forEach(trade => {
      const session = getTradeSession(trade);
      let key = 'New York';
      if (/Asia|Tokyo|Sydney/i.test(session)) key = 'Asian';
      else if (/London/i.test(session)) key = 'London';
      else if (/Overlap/i.test(session)) key = 'Overlap';
      else if (/York/i.test(session)) key = 'New York';
      
      stats[key].pnl += safePnL(trade.pnl);
      stats[key].count += 1;
      if (trade.result === 'Win') stats[key].wins += 1;
    });

    return Object.entries(stats).map(([name, d]) => ({
      name,
      pnl: d.pnl,
      winRate: d.count > 0 ? (d.wins / d.count) * 100 : 0,
      count: d.count
    }));
  }, [trades]);

  return (
    <div className={clsx(
      "p-6 rounded-[32px] border h-full flex flex-col justify-between",
      "bg-[#000000] border-zinc-900 shadow-xl"
    )}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-black tracking-tight italic flex items-center gap-2 uppercase">
            <Sunrise size={20} className="text-brand" />
            Market Sessions
          </h3>
        </div>
        <div className="text-[10px] font-black uppercase tracking-widest opacity-50 text-right">
          Timezone: {ANALYTICS_TIMEZONE_LABEL}
        </div>
      </div>

      <div className="h-[200px] min-h-[200px] w-full mb-6">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDarkMode ? "#27272a" : "#e2e8f0"} />
            <XAxis dataKey="name" stroke={isDarkMode ? "#71717a" : "#94a3b8"} fontSize={10} tickLine={false} axisLine={false} />
            <YAxis stroke={isDarkMode ? "#71717a" : "#94a3b8"} fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => `${currencySymbol}${Math.abs(Number(v)).toFixed(2)}`} />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: isDarkMode ? '#18181b' : '#fff', 
                borderRadius: '16px', 
                border: isDarkMode ? '1px solid #27272a' : '1px solid #e2e8f0',
                fontWeight: 'bold',
                color: isDarkMode ? '#fff' : '#000'
              }}
              itemStyle={{ 
                fontSize: '12px',
                color: isDarkMode ? '#fff' : '#000'
              }}
              cursor={{ fill: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }}
              formatter={(value: number) => [formatPnL(value, currencySymbol), 'PNL']}
            />
            <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? '#10B981' : '#EF4444'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="space-y-2">
        {data.map(s => (
          <div key={s.name} className={clsx(
            "p-3 rounded-2xl border flex items-center justify-between",
            isDarkMode ? "bg-black/20 border-zinc-800/50" : "bg-slate-50 border-slate-100"
          )}>
            <div className="flex items-center gap-3">
              {getSessionIcon(s.name)}
              <span className="text-xs font-black uppercase tracking-tight">{s.name}</span>
            </div>
            <div className="text-right">
              <div className={clsx("text-sm font-black", s.pnl >= 0 ? "text-emerald-500" : "text-rose-500")}>
                {s.pnl >= 0 ? '+' : ''}{currencySymbol}{Math.abs(s.pnl).toLocaleString()}
              </div>
              <div className="text-[10px] font-bold opacity-40 uppercase tracking-widest">{s.winRate.toFixed(0)}% WR • {s.count} trades</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export const HourlyPerformanceWidget: React.FC<WidgetProps> = ({ trades, isDarkMode, currencySymbol }) => {
  const data = useMemo(() => {
    const stats: Record<number, { count: number, wins: number, pnl: number, holdMinutes: number, holdCount: number }> = {};
    Array.from({ length: 24 }).forEach((_, i) => {
      stats[i] = { pnl: 0, count: 0, wins: 0, holdMinutes: 0, holdCount: 0 };
    });
    
    trades.forEach(t => {
      const hour = getTradeHour(t);
      if (hour !== null) {
        const holdMinutes = calculateHoldMinutes(t);
        stats[hour].pnl += safePnL(t.pnl);
        stats[hour].count += 1;
        if (t.result === 'Win') stats[hour].wins += 1;
        if (holdMinutes !== null) {
          stats[hour].holdMinutes += holdMinutes;
          stats[hour].holdCount += 1;
        }
      }
    });

    return Object.entries(stats).map(([hour, d]) => ({
      hour: parseInt(hour),
      label: `${hour}:00`,
      pnl: d.pnl,
      count: d.count,
      avgHoldMinutes: d.holdCount > 0 ? d.holdMinutes / d.holdCount : 0,
    })).filter(d => d.count > 0);
  }, [trades]);

  const rankingData = useMemo(() => {
    const stats: Record<number, { count: number, wins: number, pnl: number, holdMinutes: number, holdCount: number }> = {};
    Array.from({ length: 24 }).forEach((_, i) => {
      stats[i] = { count: 0, wins: 0, pnl: 0, holdMinutes: 0, holdCount: 0 };
    });

    trades.forEach(t => {
      const hour = getTradeHour(t);
      if (hour === null) return;

      const holdMinutes = calculateHoldMinutes(t);
      const bucket = stats[hour];
      bucket.pnl += safePnL(t.pnl);
      bucket.count += 1;
      if (t.result === 'Win') bucket.wins += 1;
      if (holdMinutes !== null) {
        bucket.holdMinutes += holdMinutes;
        bucket.holdCount += 1;
      }
    });

    return Object.entries(stats)
      .map(([hour, d]) => ({
        hour: parseInt(hour),
        label: `${hour}:00`,
        count: d.count,
        wins: d.wins,
        winRate: d.count > 0 ? (d.wins / d.count) * 100 : 0,
        avgHoldMinutes: d.holdCount > 0 ? d.holdMinutes / d.holdCount : 0,
        avgPnL: d.count > 0 ? d.pnl / d.count : 0,
      }))
      .filter(d => d.count >= 3)
      .sort((a, b) => b.winRate - a.winRate || b.avgPnL - a.avgPnL || b.count - a.count);
  }, [trades]);

  const bestHour = rankingData[0] || null;
  const worstHour = rankingData.length > 0 ? [...rankingData].sort((a, b) => a.winRate - b.winRate || a.avgPnL - b.avgPnL || a.count - b.count)[0] : null;

  return (
    <div className={clsx(
      "p-6 rounded-[32px] border h-full flex flex-col justify-between",
      "bg-[#000000] border-zinc-900 shadow-xl"
    )}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-black tracking-tight italic flex items-center gap-2 uppercase">
            <Clock size={20} className="text-brand" />
            Hourly Performance
          </h3>
        </div>
        <div className="text-[10px] font-black uppercase tracking-widest opacity-50 text-right">
          Timezone: {ANALYTICS_TIMEZONE_LABEL}
        </div>
      </div>

      <div className="h-[220px] min-h-[220px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDarkMode ? "#27272a" : "#e2e8f0"} />
            <XAxis dataKey="label" stroke={isDarkMode ? "#71717a" : "#94a3b8"} fontSize={8} tickLine={false} axisLine={false} />
            <YAxis stroke={isDarkMode ? "#71717a" : "#94a3b8"} fontSize={8} tickLine={false} axisLine={false} tickFormatter={(v) => `${Math.round(Number(v))}m`} />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: isDarkMode ? '#18181b' : '#fff', 
                borderRadius: '16px', 
                border: isDarkMode ? '1px solid #27272a' : '1px solid #e2e8f0',
                fontWeight: 'bold',
                color: isDarkMode ? '#fff' : '#000'
              }}
              itemStyle={{ 
                fontSize: '10px',
                color: isDarkMode ? '#fff' : '#000'
              }}
              cursor={{ fill: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }}
              formatter={(value: number, name, props) => {
                const hourData = props.payload as { count: number; hour: number };
                const holdLabel = formatDuration(Number(value));
                return [
                  `${holdLabel}${hourData?.count ? ` • ${hourData.count} trades` : ''}`,
                  'Avg hold'
                ];
              }}
            />
            <ReferenceLine y={0} stroke={isDarkMode ? "#3f3f46" : "#cbd5e1"} />
            <Bar dataKey="avgHoldMinutes" radius={[2, 2, 0, 0]}>
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill="#6366F1" />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {[
          {
            label: 'Best hour',
            item: bestHour,
            tone: 'emerald',
            icon: TrendingUp,
          },
          {
            label: 'Worst hour',
            item: worstHour,
            tone: 'rose',
            icon: TrendingDown,
          },
        ].map(({ label, item, tone, icon: Icon }) => (
          <div
            key={label}
            className={clsx(
              "rounded-2xl border p-4",
              isDarkMode ? "bg-black/20 border-zinc-800/50" : "bg-slate-50 border-slate-100"
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className={clsx(
                  "rounded-xl p-2",
                  tone === 'emerald' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'
                )}>
                  <Icon size={16} />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest opacity-50">{label}</p>
                  <p className="text-sm font-black">{item ? item.label : 'N/A'}</p>
                </div>
              </div>
              <div className={clsx("text-right", tone === 'emerald' ? 'text-emerald-500' : 'text-rose-500')}>
                <p className="text-sm font-black">{item ? `${item.winRate.toFixed(0)}% WR` : 'No data'}</p>
                <p className="text-[10px] font-bold uppercase tracking-widest opacity-50">
                  {item ? `${item.count} trades` : 'Min 3 trades'}
                </p>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
              <div className={clsx(
                "rounded-xl border px-3 py-2",
                isDarkMode ? "border-white/[0.06] bg-white/[0.03]" : "border-slate-200 bg-white"
              )}>
                <p className="text-[9px] font-black uppercase tracking-widest opacity-40">Avg hold</p>
                <p className="mt-1 font-black">{item ? formatDuration(item.avgHoldMinutes) : 'N/A'}</p>
              </div>
              <div className={clsx(
                "rounded-xl border px-3 py-2",
                isDarkMode ? "border-white/[0.06] bg-white/[0.03]" : "border-slate-200 bg-white"
              )}>
                <p className="text-[9px] font-black uppercase tracking-widest opacity-40">Avg trade</p>
                <p className="mt-1 font-black">
                  {item ? `${item.avgPnL >= 0 ? '+' : '-'}${currencySymbol}${Math.abs(item.avgPnL).toFixed(2)}` : 'N/A'}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export const DailyActivityHeatmap: React.FC<WidgetProps> = ({ trades, isDarkMode, currencySymbol }) => {
  const data = useMemo(() => {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    const stats: Record<string, { pnl: number, count: number, wins: number }> = {};
    const dayTotalsByDate: Record<string, number> = {};
    days.forEach(d => stats[d] = { pnl: 0, count: 0, wins: 0 });

    trades.forEach(t => {
      const day = getSastWeekdayFromDate(t.date);
      if (stats[day]) {
        const pnl = safePnL(t.pnl);
        stats[day].pnl += pnl;
        stats[day].count += 1;
        if (pnl > 0) stats[day].wins += 1;
        dayTotalsByDate[t.date] = (dayTotalsByDate[t.date] || 0) + pnl;
      }
    });

    return days.map((name) => {
      const d = stats[name];
      const dayTrades = trades.filter(t => getSastWeekdayFromDate(t.date) === name);
      const pnlList = dayTrades.map(t => safePnL(t.pnl)).sort((a, b) => a - b);
      const medianTradePnL = pnlList.length > 0 ? pnlList[Math.floor((pnlList.length - 1) / 2)] : 0;

      const dayTotals = Object.entries(dayTotalsByDate)
        .filter(([date]) => getSastWeekdayFromDate(date) === name)
        .map(([, total]) => total);
      const positiveDayRate = dayTotals.length > 0
        ? (dayTotals.filter(total => total > 0).length / dayTotals.length) * 100
        : 0;

      const positivePnL = pnlList.filter(pnl => pnl > 0);
      const totalPositivePnL = positivePnL.reduce((sum, pnl) => sum + pnl, 0);
      const topThreeWinConcentration = totalPositivePnL > 0
        ? (positivePnL.slice(-3).reduce((sum, pnl) => sum + pnl, 0) / totalPositivePnL) * 100
        : 0;

      return {
        name,
        pnl: d.pnl,
        absPnl: Math.abs(d.pnl),
        count: d.count,
        winRate: d.count > 0 ? (d.wins / d.count) * 100 : 0,
        positiveDayRate,
        medianTradePnL,
        topThreeWinConcentration,
      };
    });
  }, [trades]);

  const tooltipContent = useMemo(() => {
    if (data.length === 0) return null;

    const bestMedianDay = [...data].sort((a, b) => b.medianTradePnL - a.medianTradePnL)[0];
    const mostConsistentDay = [...data].sort((a, b) => b.positiveDayRate - a.positiveDayRate)[0];
    const mostConcentratedDay = [...data].sort((a, b) => b.topThreeWinConcentration - a.topThreeWinConcentration)[0];

    return (
      <div className="space-y-2">
        <div className="text-[9px] font-black uppercase tracking-[0.25em] opacity-50">What this adds</div>
        <div className="space-y-2">
          <div>
            <div className="opacity-60 font-black uppercase tracking-widest text-[9px]">Typical trade</div>
            <div className="mt-0.5 text-[10px] font-bold">
              {bestMedianDay.name} has the strongest median trade at {formatSignedPnL(bestMedianDay.medianTradePnL, currencySymbol)}.
            </div>
          </div>
          <div>
            <div className="opacity-60 font-black uppercase tracking-widest text-[9px]">Consistency</div>
            <div className="mt-0.5 text-[10px] font-bold">
              {mostConsistentDay.name} closes green on {formatPercent(mostConsistentDay.positiveDayRate)} of its trading days.
            </div>
          </div>
          <div>
            <div className="opacity-60 font-black uppercase tracking-widest text-[9px]">Edge quality</div>
            <div className="mt-0.5 text-[10px] font-bold">
              {mostConcentratedDay.name} is the most top-heavy, with {formatPercent(mostConcentratedDay.topThreeWinConcentration)} of its winning PnL coming from the top 3 trades.
            </div>
          </div>
        </div>
      </div>
    );
  }, [data, currencySymbol]);

  const maxVal = Math.max(...data.map(x => x.absPnl), 1);

  return (
    <div className={clsx(
      "p-8 rounded-[32px] border h-full flex flex-col justify-between",
      isDarkMode ? "bg-zinc-950 border-zinc-900 shadow-2xl" : "bg-white border-slate-200 shadow-xl"
    )}>
      <div className="mb-4">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-black tracking-tight italic flex items-center gap-3 uppercase">
            <BarChart2 size={24} className="text-brand" />
            Day of Week
          </h3>
          <InfoTooltip content={tooltipContent} isDarkMode={isDarkMode}>
            <HelpCircle size={14} className="opacity-40 cursor-help hover:opacity-100" />
          </InfoTooltip>
        </div>
        <p className="text-[10px] font-bold opacity-40 uppercase tracking-widest mt-1 ml-9">Performance by Trading Day</p>
      </div>

      {/* CENTERED: Radar Chart */}
      <div className="flex-1 flex items-center justify-center w-full min-h-[260px] py-4">
        <div className="w-full h-full max-w-[280px] max-h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart cx="50%" cy="50%" outerRadius="80%" data={data}>
              <PolarGrid stroke={isDarkMode ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"} />
              <PolarAngleAxis 
                dataKey="name" 
                tick={{ fill: isDarkMode ? '#a1a1aa' : '#64748b', fontSize: 10, fontWeight: '900' }} 
              />
              <Radar
                name="Win Rate"
                dataKey="winRate"
                stroke="#8251EE"
                strokeWidth={3}
                fill="#8251EE"
                fillOpacity={0.3}
                animationDuration={1500}
              />
              <Tooltip 
                cursor={{ stroke: '#8251EE', strokeWidth: 1, strokeOpacity: 0.2 }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;

                  const point = payload[0]?.payload as { winRate?: number; count?: number };
                  const winRate = typeof point?.winRate === 'number' ? point.winRate : Number(payload[0]?.value ?? 0);
                  const totalTrades = point?.count ?? 0;

                  return (
                    <div className="rounded-2xl border border-zinc-800 bg-[#000000] px-4 py-3 shadow-2xl">
                      <div className="text-sm font-black text-white">{label}</div>
                      <div className="mt-1 text-xs font-semibold text-zinc-300">
                        Win Rate: <span className="text-violet-400">{winRate.toFixed(0)}%</span>
                      </div>
                      <div className="mt-1 text-xs font-semibold text-zinc-300">
                        Total trades: <span className="text-white">{totalTrades}</span>
                      </div>
                    </div>
                  );
                }}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="space-y-4 mt-4">
        {data.map(d => (
          <div key={d.name} className="space-y-1.5">
            <div className="flex justify-between items-center px-1">
              <span className="text-[10px] font-black uppercase tracking-widest opacity-60">{d.name}</span>
              <span className={clsx("text-xs font-black", d.pnl >= 0 ? "text-emerald-500" : "text-rose-500")}>
                {d.pnl >= 0 ? '+' : ''}{currencySymbol}{Math.abs(d.pnl).toLocaleString()}
              </span>
            </div>
            <div className={clsx("h-1.5 w-full rounded-full overflow-hidden", isDarkMode ? "bg-zinc-800" : "bg-slate-100")}>
              <div 
                className={clsx("h-full rounded-full", d.pnl >= 0 ? "bg-emerald-500" : "bg-rose-500")}
                style={{ width: `${Math.min(100, (d.absPnl / maxVal) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
