import React, { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Trade, UserProfile } from '../../../types';
import { getCompletedTrades } from '../../../lib/analyticsUtils';
import { haptic } from '../../../lib/haptics';

interface MobileCalendarViewProps {
  trades: Trade[];
  userProfile?: UserProfile;
  isDarkMode?: boolean;
}

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

export const MobileCalendarView: React.FC<MobileCalendarViewProps> = ({ trades, userProfile }) => {
  const completedTrades = useMemo(() => getCompletedTrades(trades), [trades]);
  const currencySymbol = userProfile?.currencySymbol || '$';
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [viewMode, setViewMode] = useState<'Mo' | 'Yr'>('Mo');

  const yr = currentDate.getFullYear();
  const mo = currentDate.getMonth();

  const navigate = (dir: -1 | 1) => {
    try { haptic.selection(); } catch {}
    setCurrentDate(new Date(yr, mo + dir, 1));
  };

  // Trades → day map
  const tradesByDay = useMemo(() => {
    const map = new Map<string, { pnl: number; count: number }>();
    completedTrades.forEach((t) => {
      const ds = t.closeTime || t.openTime || t.date;
      if (!ds) return;
      const d = new Date(ds);
      if (isNaN(d.getTime())) return;
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const ex = map.get(key) || { pnl: 0, count: 0 };
      ex.pnl += (t.pnl || 0);
      ex.count++;
      map.set(key, ex);
    });
    return map;
  }, [completedTrades]);

  // Calendar cells
  const cells = useMemo(() => {
    const firstDay = new Date(yr, mo, 1);
    const totalDays = new Date(yr, mo + 1, 0).getDate();
    let startDow = firstDay.getDay() - 1; // Mon=0
    if (startDow === -1) startDow = 6;

    const out: Array<{ day: number | null; key: string | null; pnl?: number; count?: number }> = [];
    for (let i = 0; i < startDow; i++) out.push({ day: null, key: null });
    for (let d = 1; d <= totalDays; d++) {
      const key = `${yr}-${String(mo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const data = tradesByDay.get(key);
      out.push({ day: d, key, pnl: data?.pnl, count: data?.count });
    }
    return out;
  }, [yr, mo, tradesByDay]);

  // Weekly breakdown
  const weeklyInfo = useMemo(() => {
    const ROWS = 6;
    const weeks = Array.from({ length: ROWS }, () => ({
      trades: 0, wins: 0, lossCount: 0, gainSum: 0, lossSum: 0,
    }));

    cells.forEach((cell, idx) => {
      if (!cell.day || !cell.key) return;
      const wIdx = Math.floor(idx / 7);
      if (wIdx >= ROWS) return;
      const data = tradesByDay.get(cell.key);
      if (!data) return;

      const dayTrades = completedTrades.filter((t) => {
        const ds = t.closeTime || t.openTime || t.date;
        if (!ds) return false;
        const d = new Date(ds);
        const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        return k === cell.key;
      });

      dayTrades.forEach((t) => {
        const p = t.pnl || 0;
        weeks[wIdx].trades++;
        if (p > 0) { weeks[wIdx].wins++; weeks[wIdx].gainSum += p; }
        else if (p < 0) { weeks[wIdx].lossCount++; weeks[wIdx].lossSum += Math.abs(p); }
      });
    });

    const WEEK_NAMES = ['First','Second','Third','Fourth','Fifth','Sixth'];
    const processed = weeks.map((w, i) => ({
      name: WEEK_NAMES[i],
      trades: w.trades,
      winPct: w.trades > 0 ? Math.round(w.wins / w.trades * 100) : 0,
      avgGain: w.wins > 0 ? Math.round(w.gainSum / w.wins) : 0,
      avgLoss: w.lossCount > 0 ? Math.round(w.lossSum / w.lossCount) : 0,
    }));

    const active = processed.filter(w => w.trades > 0);
    const totalTrades = processed.reduce((s, w) => s + w.trades, 0);
    const avgTrades = active.length > 0 ? Math.round(totalTrades / active.length) : 0;
    const allWins = processed.reduce((s, w) => s + (w.winPct > 0 ? w.trades * w.winPct / 100 : 0), 0);
    const avgWinPct = totalTrades > 0 ? Math.round(allWins / totalTrades * 100) : 0;
    const avgGainAll = processed.filter(w=>w.avgGain>0).map(w=>w.avgGain);
    const avgGain = avgGainAll.length > 0 ? Math.round(avgGainAll.reduce((a,b)=>a+b,0)/avgGainAll.length) : 0;
    const avgLossAll = processed.filter(w=>w.avgLoss>0).map(w=>w.avgLoss);
    const avgLoss = avgLossAll.length > 0 ? Math.round(avgLossAll.reduce((a,b)=>a+b,0)/avgLossAll.length) : 0;

    return { weeks: processed, totalTrades, avgTrades, avgWinPct, avgGain, avgLoss };
  }, [cells, tradesByDay, completedTrades]);

  return (
    <div className="pb-nav px-4 pt-3 space-y-4">
      {/* Navigator */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="jfx-h2 text-white">{MONTH_NAMES[mo]}</span>
          <span className="jfx-caption">{yr}</span>
          <button
            onClick={() => navigate(-1)}
            aria-label="Previous"
            className="w-7 h-7 rounded-lg flex items-center justify-center active:scale-95 transition-all"
            style={{ background: 'var(--jfx-surface)', border: '1px solid var(--jfx-border)' }}
          >
            <ChevronLeft size={15} style={{ color: 'var(--jfx-text-60)' }} />
          </button>
          <button
            onClick={() => navigate(1)}
            aria-label="Next"
            className="w-7 h-7 rounded-lg flex items-center justify-center active:scale-95 transition-all"
            style={{ background: 'var(--jfx-surface)', border: '1px solid var(--jfx-border)' }}
          >
            <ChevronRight size={15} style={{ color: 'var(--jfx-text-60)' }} />
          </button>
        </div>

        {/* View toggle */}
        <div className="flex items-center p-0.5 rounded-xl" style={{ background: 'var(--jfx-surface)', border: '1px solid var(--jfx-border)' }}>
          {(['Mo','Yr'] as const).map(v => (
            <button
              key={v}
              onClick={() => { try { haptic.selection(); } catch {} setViewMode(v); }}
              className="px-3 py-1 rounded-xl text-xs font-bold transition-all"
              style={viewMode === v
                ? { background: 'var(--jfx-accent)', color: '#fff', boxShadow: 'var(--shadow-accent)' }
                : { color: 'var(--jfx-text-40)' }
              }
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="jfx-card p-3">
        {/* Day headers */}
        <div className="grid grid-cols-7 mb-1.5">
          {['Mo','Tu','We','Th','Fr','Sa','Su'].map(d => (
            <span key={d} className="text-center" style={{ fontSize: '9px', fontWeight: 800, letterSpacing: '0.08em', color: 'var(--jfx-text-40)', textTransform: 'uppercase' }}>
              {d}
            </span>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 gap-1">
          {cells.map((cell, idx) => {
            if (!cell.day) return <div key={`e-${idx}`} />;
            const hasData = (cell.count || 0) > 0;
            const isProfit = (cell.pnl || 0) > 0;
            const isLoss = (cell.pnl || 0) < 0;
            return (
              <div
                key={`d-${cell.day}`}
                className="h-11 rounded-xl flex flex-col justify-between p-1.5 transition-all"
                style={hasData ? {
                  background: isProfit
                    ? 'rgba(52,211,153,0.08)'
                    : isLoss ? 'rgba(244,63,94,0.08)' : 'var(--jfx-accent-soft)',
                  border: `1px solid ${isProfit ? 'rgba(52,211,153,0.25)' : isLoss ? 'rgba(244,63,94,0.25)' : 'var(--jfx-accent-border)'}`,
                } : {
                  background: 'var(--jfx-surface)',
                  border: '1px solid var(--jfx-border-soft)',
                }}
              >
                <span style={{ fontSize: '10px', fontWeight: 700, color: hasData ? '#fff' : 'var(--jfx-text-60)' }}>
                  {cell.day}
                </span>
                {hasData && (
                  <span className="jfx-value-mono truncate leading-none" style={{
                    fontSize: '8px',
                    fontWeight: 900,
                    color: isProfit ? '#34d399' : isLoss ? '#f43f5e' : 'var(--jfx-accent)',
                  }}>
                    {isProfit ? `+${currencySymbol}${Math.round(cell.pnl!)}` :
                     isLoss   ? `-${currencySymbol}${Math.abs(Math.round(cell.pnl!))}` :
                                `${cell.count}T`}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Weekly Info Table */}
      <div>
        <p className="jfx-label mb-2">Weekly Info</p>
        <div className="jfx-card overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-5 px-3 py-2 border-b" style={{ borderColor: 'var(--jfx-border)' }}>
            {['Week','Trades','Win %','Avg Gain','Avg Loss'].map(h => (
              <span key={h} className="jfx-label text-center first:text-left">{h}</span>
            ))}
          </div>
          {/* Rows */}
          <div className="divide-y" style={{ borderColor: 'var(--jfx-border-soft)' }}>
            {weeklyInfo.weeks.map((w) => (
              <div key={w.name} className="grid grid-cols-5 px-3 py-2.5 items-center">
                <span className="jfx-caption" style={{ fontSize: '9.5px' }}>{w.name}</span>
                <span className="jfx-value-mono text-center text-xs font-black text-white">{w.trades}</span>
                <span className="jfx-value-mono text-center text-xs font-black text-white">{w.winPct > 0 ? `${w.winPct}%` : '—'}</span>
                <span className="jfx-value-mono text-right text-xs font-black text-emerald-400">{w.avgGain > 0 ? `${currencySymbol}${w.avgGain}` : '—'}</span>
                <span className="jfx-value-mono text-right text-xs font-black text-rose-400">{w.avgLoss > 0 ? `${currencySymbol}${w.avgLoss}` : '—'}</span>
              </div>
            ))}
          </div>
          {/* Average row */}
          <div className="grid grid-cols-5 px-3 py-2.5 border-t" style={{ background: 'var(--jfx-surface)', borderColor: 'var(--jfx-border)' }}>
            <span className="jfx-caption">Average</span>
            <span className="jfx-value-mono text-center text-xs font-black text-white">{weeklyInfo.avgTrades}</span>
            <span className="jfx-value-mono text-center text-xs font-black text-white">{weeklyInfo.avgWinPct > 0 ? `${weeklyInfo.avgWinPct}%` : '—'}</span>
            <span className="jfx-value-mono text-right text-xs font-black text-emerald-400">{weeklyInfo.avgGain > 0 ? `${currencySymbol}${weeklyInfo.avgGain}` : '—'}</span>
            <span className="jfx-value-mono text-right text-xs font-black text-rose-400">{weeklyInfo.avgLoss > 0 ? `${currencySymbol}${weeklyInfo.avgLoss}` : '—'}</span>
          </div>
          {/* Total row */}
          <div className="grid grid-cols-5 px-3 py-2.5 border-t" style={{ background: '#0d0d0d', borderColor: 'var(--jfx-border)' }}>
            <span className="jfx-h2 text-white">Total</span>
            <span className="jfx-value-mono text-center text-xs font-black" style={{ color: 'var(--jfx-accent)' }}>{weeklyInfo.totalTrades}</span>
            <span className="jfx-caption text-center">—</span>
            <span className="jfx-caption text-right">—</span>
            <span className="jfx-caption text-right">—</span>
          </div>
        </div>
      </div>
    </div>
  );
};
