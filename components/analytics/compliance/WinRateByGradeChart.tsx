import React, { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { HelpCircle } from 'lucide-react';
import type { Trade } from '../../../types';
import { winRateByGrade } from '../../../lib/disciplineChecklist';
import { Tooltip } from '../../ui/Tooltip';

interface WinRateByGradeChartProps {
  trades: Trade[];
  isDarkMode: boolean;
  onInfoClick?: () => void;
}

const BAR_COLORS: Record<string, string> = {
  A: '#10b981',
  B: '#38bdf8',
  'C–D': '#f59e0b',
  F: '#f43f5e',
};

export const WinRateByGradeChart: React.FC<WinRateByGradeChartProps> = ({ trades, isDarkMode, onInfoClick }) => {
  const data = useMemo(() => winRateByGrade(trades).filter((b) => b.count > 0), [trades]);
  const hasData = data.length > 0;
  return (
    <div className="bg-[#0a0a0a] text-white rounded-[14px] p-6 border-0 flex flex-col">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-[15px] font-semibold tracking-tight">Win Rate by Execution Grade</h2>
        <Tooltip content="Win rate per execution grade. Grade measures rule-following only — never profitability." isDarkMode={true} onInfoClick={onInfoClick}>
          <HelpCircle size={14} className="opacity-40 cursor-help hover:opacity-100" />
        </Tooltip>
      </div>
      <div className="min-h-[240px] flex-1">
        {!hasData ? (
          <p className="text-center text-[14px] text-[#71717a] pt-20">No graded trades yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: -16 }} barCategoryGap="28%">
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis dataKey="grade" tick={{ fill: '#a1a1aa', fontSize: 11, fontWeight: 800 }} tickLine={false} axisLine={false} />
              <YAxis domain={[0, 100]} tick={{ fill: '#71717a', fontSize: 9 }} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => `${v}%`} />
              <RechartsTooltip
                cursor={{ fill: 'rgba(255,255,255,0.06)' }}
                content={({ active, payload }: any) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0]?.payload;
                  if (!row) return null;
                  return (
                    <div style={{ background: '#101012', border: '1px solid #3f3f46', borderRadius: 12, padding: '10px 14px', fontSize: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
                      <p style={{ color: '#ffffff', fontWeight: 800, margin: 0 }}>Grade {row.grade}</p>
                      <p style={{ color: '#d4d4d8', margin: '6px 0 0' }}>
                        Win rate:{' '}
                        <span style={{ color: '#ffffff', fontWeight: 700 }}>
                          {row.winRate === null ? '—' : `${row.winRate}%`} ({row.wins}/{row.count} trades)
                        </span>
                      </p>
                      <p style={{ color: '#d4d4d8', margin: '4px 0 0' }}>
                        Net P&L:{' '}
                        <span style={{ color: row.netPnl < 0 ? '#fb7185' : '#34d399', fontWeight: 700 }}>
                          {row.netPnl < 0 ? '−' : row.netPnl > 0 ? '+' : ''}{Math.abs(row.netPnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </p>
                    </div>
                  );
                }}
              />
              <Bar dataKey="winRate" radius={[8, 8, 4, 4]}>
                {data.map((row) => (
                  <Cell key={row.grade} fill={BAR_COLORS[row.grade] ?? '#71717a'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};
