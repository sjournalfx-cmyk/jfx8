import React, { useMemo } from 'react';
import { HelpCircle } from 'lucide-react';
import type { ChecklistTemplate, Trade } from '../../../types';
import { CHECKLIST_PHASES, ruleLeakage } from '../../../lib/disciplineChecklist';
import { Tooltip } from '../../ui/Tooltip';

interface RuleLeakageListProps {
  trades: Trade[];
  template: ChecklistTemplate;
  isDarkMode: boolean;
  onInfoClick?: () => void;
}

export const RuleLeakageList: React.FC<RuleLeakageListProps> = ({ trades, template, isDarkMode, onInfoClick }) => {
  const leakage = useMemo(() => ruleLeakage(trades, template), [trades, template]);
  const gradedCount = useMemo(
    () => trades.filter((t) => t.result !== 'Pending' && typeof t.adherenceRate === 'number').length,
    [trades],
  );

  return (
    <div className="bg-[#0a0a0a] text-white rounded-[14px] p-6 border-0 flex flex-col">
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-[15px] font-semibold tracking-tight">Rule Leakage</h2>
        <Tooltip content="Which checklist rules get skipped most often. The top of this list is exactly what needs psychological training." isDarkMode={true} onInfoClick={onInfoClick}>
          <HelpCircle size={14} className="opacity-40 cursor-help hover:opacity-100" />
        </Tooltip>
      </div>
      <p className="text-[11px] text-zinc-500 font-medium mb-4">
        {template.name} · fail-rate across {gradedCount} graded trades
      </p>
      {leakage.length === 0 || gradedCount === 0 ? (
        <p className="text-center text-[14px] text-[#71717a] py-10">Grade some trades first — leakage analysis needs checklist snapshots.</p>
      ) : (
        <div className="space-y-5">
          {CHECKLIST_PHASES.map((phase) => {
            const items = leakage.filter((l) => l.phase === phase.id);
            if (!items.length) return null;
            return (
              <div key={phase.id}>
                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">{phase.label}</p>
                <div className="space-y-2">
                  {items.map((item) => (
                    <div key={item.itemId}>
                      <div className="flex items-baseline justify-between gap-3 mb-1">
                        <p className="text-[13px] font-medium text-zinc-200 truncate">“{item.text}”</p>
                        <p className={`text-[12px] font-black shrink-0 ${(item.failRate ?? 0) >= 30 ? 'text-rose-400' : (item.failRate ?? 0) >= 10 ? 'text-amber-400' : 'text-emerald-400'}`}>
                          {item.failRate === null ? '—' : `Failed ${item.failRate}%`}
                        </p>
                      </div>
                      <div className="h-1.5 rounded-full bg-zinc-800/80 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${(item.failRate ?? 0) >= 30 ? 'bg-rose-500' : (item.failRate ?? 0) >= 10 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                          style={{ width: `${Math.min(100, item.failRate ?? 0)}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-zinc-600 font-medium mt-0.5">
                        {item.failCount}/{item.tradeCount} trades
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
