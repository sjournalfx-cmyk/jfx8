import React, { useMemo } from 'react';
import {
  Line,
  LineChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { HelpCircle } from 'lucide-react';
import type { Trade } from '../../../types';
import { complianceEquityCurve } from '../../../lib/disciplineChecklist';
import { Tooltip } from '../../ui/Tooltip';

interface ComplianceEquityCurveProps {
  trades: Trade[];
  isDarkMode: boolean;
  currencySymbol: string;
  onInfoClick?: () => void;
}

export const ComplianceEquityCurve: React.FC<ComplianceEquityCurveProps> = ({
  trades,
  isDarkMode,
  currencySymbol,
  onInfoClick,
}) => {
  const data = useMemo(() => complianceEquityCurve(trades), [trades]);

  return (
    <div className="bg-[#0a0a0a] text-white rounded-[14px] p-6 border-0 flex flex-col">
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-[15px] font-semibold tracking-tight">Equity: Compliant vs Non-Compliant</h2>
        <Tooltip content="Cumulative P&L split by rule compliance (≥80% vs <80%). Breaking rules bleeds profits over time." isDarkMode={true} onInfoClick={onInfoClick}>
          <HelpCircle size={14} className="opacity-40 cursor-help hover:opacity-100" />
        </Tooltip>
      </div>
      <div className="flex items-center gap-4 mb-4 text-[10px] font-bold uppercase tracking-widest">
        <span className="flex items-center gap-1.5 text-emerald-400"><span className="w-2.5 h-0.5 bg-emerald-500 rounded-full inline-block" /> Compliant ≥80%</span>
        <span className="flex items-center gap-1.5 text-rose-400"><span className="w-2.5 h-0.5 bg-rose-500 rounded-full inline-block" /> Non-compliant</span>
      </div>
      <div className="min-h-[260px] flex-1">
        {data.length === 0 ? (
          <p className="text-center text-[14px] text-[#71717a] pt-20">No graded trades yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: '#71717a', fontSize: 9 }} tickLine={false} axisLine={false} minTickGap={48} />
              <YAxis tick={{ fill: '#71717a', fontSize: 9 }} tickLine={false} axisLine={false} width={56} />
              <RechartsTooltip
                cursor={{ stroke: 'rgba(255,255,255,0.25)' }}
                content={({ active, payload, label }: any) => {
                  if (!active || !payload?.length) return null;
                  const fmt = (v: unknown) =>
                    `${currencySymbol}${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                  return (
                    <div style={{ background: '#101012', border: '1px solid #3f3f46', borderRadius: 12, padding: '10px 14px', fontSize: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
                      <p style={{ color: '#ffffff', fontWeight: 800, margin: 0 }}>{label}</p>
                      {payload.map((p: any) => (
                        <p key={String(p.dataKey)} style={{ color: '#d4d4d8', margin: '6px 0 0' }}>
                          {p.dataKey === 'compliant' ? 'Compliant' : 'Non-compliant'}:{' '}
                          <span style={{ color: p.dataKey === 'compliant' ? '#34d399' : '#fb7185', fontWeight: 700 }}>
                            {fmt(p.value)}
                          </span>
                        </p>
                      ))}
                    </div>
                  );
                }}
              />
              <Line type="monotone" dataKey="compliant" stroke="#10b981" strokeWidth={2.5} dot={false} name="compliant" />
              <Line type="monotone" dataKey="nonCompliant" stroke="#f43f5e" strokeWidth={2.5} dot={false} name="nonCompliant" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};
