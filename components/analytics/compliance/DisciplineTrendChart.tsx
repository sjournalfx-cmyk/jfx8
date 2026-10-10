import React, { useMemo } from 'react';
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { HelpCircle } from 'lucide-react';
import type { Trade } from '../../../types';
import { disciplineTrend } from '../../../lib/disciplineChecklist';
import { Tooltip } from '../../ui/Tooltip';

interface DisciplineTrendChartProps {
  trades: Trade[];
  isDarkMode: boolean;
  currencySymbol: string;
  onInfoClick?: () => void;
}

export const DisciplineTrendChart: React.FC<DisciplineTrendChartProps> = ({
  trades,
  isDarkMode,
  currencySymbol,
  onInfoClick,
}) => {
  const data = useMemo(() => disciplineTrend(trades), [trades]);

  return (
    <div className="bg-[#0a0a0a] text-white rounded-[14px] p-6 border-0 flex flex-col">
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-[15px] font-semibold tracking-tight">Discipline Trend</h2>
        <Tooltip content="Weekly rule-compliance % against cumulative account growth. Improving discipline should lead equity." isDarkMode={true} onInfoClick={onInfoClick}>
          <HelpCircle size={14} className="opacity-40 cursor-help hover:opacity-100" />
        </Tooltip>
      </div>
      <div className="flex items-center gap-4 mb-4 text-[10px] font-bold uppercase tracking-widest">
        <span className="flex items-center gap-1.5 text-sky-400"><span className="w-2.5 h-0.5 bg-sky-500 rounded-full inline-block" /> Compliance %</span>
        <span className="flex items-center gap-1.5 text-zinc-400"><span className="w-2.5 h-0.5 bg-zinc-400 rounded-full inline-block" /> Cum. P&L</span>
      </div>
      <div className="min-h-[240px] flex-1">
        {data.length === 0 ? (
          <p className="text-center text-[14px] text-[#71717a] pt-20">No graded trades yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={data} margin={{ top: 4, right: -8, bottom: 0, left: -12 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis dataKey="week" tick={{ fill: '#71717a', fontSize: 9 }} tickLine={false} axisLine={false} minTickGap={32} />
              <YAxis
                yAxisId="left"
                domain={[0, 100]}
                tick={{ fill: '#71717a', fontSize: 9 }}
                tickLine={false}
                axisLine={false}
                width={44}
                tickFormatter={(v: number) => `${v}%`}
              />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: '#71717a', fontSize: 9 }} tickLine={false} axisLine={false} width={56} />
              <RechartsTooltip
                cursor={{ stroke: 'rgba(255,255,255,0.25)' }}
                content={({ active, payload, label }: any) => {
                  if (!active || !payload?.length) return null;
                  const compliance = payload.find((p: any) => p.dataKey === 'complianceRate');
                  const cum = payload.find((p: any) => p.dataKey === 'cumulativePnl');
                  return (
                    <div style={{ background: '#101012', border: '1px solid #3f3f46', borderRadius: 12, padding: '10px 14px', fontSize: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
                      <p style={{ color: '#ffffff', fontWeight: 800, margin: 0 }}>{label}</p>
                      {compliance && (
                        <p style={{ color: '#d4d4d8', margin: '6px 0 0' }}>
                          Compliance:{' '}
                          <span style={{ color: '#38bdf8', fontWeight: 700 }}>{compliance.value}%</span>
                        </p>
                      )}
                      {cum && (
                        <p style={{ color: '#d4d4d8', margin: '4px 0 0' }}>
                          Cum. P&L:{' '}
                          <span style={{ color: '#ffffff', fontWeight: 700 }}>
                            {currencySymbol}{Number(cum.value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </p>
                      )}
                    </div>
                  );
                }}
              />
              <Line yAxisId="left" type="monotone" dataKey="complianceRate" stroke="#38bdf8" strokeWidth={2.5} dot={false} name="complianceRate" />
              <Line yAxisId="right" type="monotone" dataKey="cumulativePnl" stroke="#a1a1aa" strokeWidth={1.5} strokeDasharray="5 4" dot={false} name="cumulativePnl" />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};
