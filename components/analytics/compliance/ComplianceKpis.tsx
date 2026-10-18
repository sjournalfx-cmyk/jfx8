import React, { useMemo } from 'react';
import { ListChecks } from 'lucide-react';
import type { Trade } from '../../../types';
import { EmptyState } from '../../ui/Skeleton';
import {
  averageExecutionGrade,
  disciplinePnlImpact,
  overallComplianceRate,
  snapshotTrades,
  topViolation,
} from '../../../lib/disciplineChecklist';

interface ComplianceKpisProps {
  trades: Trade[];
  isDarkMode: boolean;
  currencySymbol: string;
}

const fmtMoney = (v: number, sym: string) =>
  `${v < 0 ? '-' : v > 0 ? '+' : ''}${sym}${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const ComplianceKpis: React.FC<ComplianceKpisProps> = ({ trades, isDarkMode, currencySymbol }) => {
  const stats = useMemo(() => {
    const snaps = snapshotTrades(trades);
    const grades = snaps
      .map((t) => t.executionGrade)
      .filter((g): g is NonNullable<Trade['executionGrade']> => !!g);
    return {
      count: snaps.length,
      compliance: overallComplianceRate(trades),
      avgGrade: averageExecutionGrade(grades),
      impact: disciplinePnlImpact(trades),
      violation: topViolation(trades),
    };
  }, [trades]);

  const card = isDarkMode ? 'bg-[#0a0a0a] text-white' : 'bg-white text-slate-900 border border-slate-100 shadow-sm';
  const label = 'text-[9px] font-bold uppercase tracking-widest opacity-40';
  const empty = stats.count === 0;

  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
      <div className={`p-5 rounded-[20px] border-0 flex flex-col justify-between min-h-[110px] ${card}`}>
        <span className={label}>Compliance Rate</span>
        <div className="text-2xl font-black">{empty || stats.compliance === null ? '—' : `${stats.compliance}%`}</div>
        <span className="text-[10px] opacity-50 font-medium">{empty ? 'No graded trades yet' : `Across ${stats.count} graded trades`}</span>
      </div>
      <div className={`p-5 rounded-[20px] border-0 flex flex-col justify-between min-h-[110px] ${card}`}>
        <span className={label}>Avg Execution Grade</span>
        <div className="flex items-center gap-2">
          {stats.avgGrade ? (
            <span className="text-2xl font-black">{stats.avgGrade}</span>
          ) : (
            <span className="text-2xl font-black opacity-30">—</span>
          )}
        </div>
        <span className="text-[10px] opacity-50 font-medium">Decoupled from P&L</span>
      </div>
      <div className={`p-5 rounded-[20px] border-0 flex flex-col justify-between min-h-[110px] ${card}`}>
        <span className={label}>Discipline P&L Impact</span>
        {empty ? (
          <div className="text-2xl font-black opacity-30">—</div>
        ) : (
          <div className="space-y-0.5">
            <div className="text-[15px] font-black text-emerald-500">{fmtMoney(stats.impact.compliantPnl, currencySymbol)} <span className="text-[10px] font-bold opacity-60">compliant</span></div>
            <div className="text-[15px] font-black text-rose-500">{fmtMoney(stats.impact.nonCompliantPnl, currencySymbol)} <span className="text-[10px] font-bold opacity-60">non-compliant</span></div>
          </div>
        )}
        <span className="text-[10px] opacity-50 font-medium">≥80% vs &lt;80% adherence</span>
      </div>
      <div className={`p-5 rounded-[20px] border-0 flex flex-col justify-between min-h-[110px] ${card}`}>
        <span className={label}>Top Violation</span>
        <div className="text-[15px] font-black truncate">
          {stats.violation ? stats.violation.tag : <span className="opacity-30">—</span>}
        </div>
        <span className="text-[10px] opacity-50 font-medium">
          {stats.violation ? `${stats.violation.count}× tagged` : 'None tagged yet'}
        </span>
      </div>
    </div>
  );
};

export const ComplianceEmptyState: React.FC<{ isDarkMode: boolean; onCta?: () => void }> = ({ isDarkMode, onCta }) => (
  <div className={`rounded-[14px] border border-dashed overflow-hidden ${isDarkMode ? 'border-zinc-800' : 'border-slate-200'}`}>
    <EmptyState
      isDarkMode={isDarkMode}
      type="analytics"
      icon={<ListChecks size={40} strokeWidth={1.4} className="opacity-40" />}
      title="No graded trades yet"
      description="Open any trade → Rules tab, tap through your checklist, and your compliance stats will appear here."
      action={onCta ? { label: 'Open Journal', onClick: onCta } : undefined}
    />
  </div>
);
