import React, { useMemo } from 'react';
import { HelpCircle } from 'lucide-react';
import type { Trade } from '../../../types';
import { costOfViolations } from '../../../lib/disciplineChecklist';
import { Tooltip } from '../../ui/Tooltip';

interface CostOfMistakesTableProps {
  trades: Trade[];
  isDarkMode: boolean;
  currencySymbol: string;
  onInfoClick?: () => void;
}

const fmtMoney = (v: number, sym: string) =>
  `${v < 0 ? '-' : v > 0 ? '+' : ''}${sym}${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export const CostOfMistakesTable: React.FC<CostOfMistakesTableProps> = ({
  trades,
  isDarkMode,
  currencySymbol,
  onInfoClick,
}) => {
  const rows = useMemo(() => costOfViolations(trades), [trades]);

  return (
    <div className="bg-[#0a0a0a] text-white rounded-[14px] p-4 sm:p-6 border-0 flex flex-col min-w-0 overflow-hidden">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-[15px] font-semibold tracking-tight">Cost of Mistakes</h2>
        <Tooltip content="Net P&L grouped by violation tag, ranked by financial damage. This is what breaking rules costs you." isDarkMode={true} onInfoClick={onInfoClick}>
          <HelpCircle size={14} className="opacity-40 cursor-help hover:opacity-100" />
        </Tooltip>
      </div>
      {rows.length === 0 ? (
        <p className="text-center text-[14px] text-[#71717a] py-10">No violations tagged yet. Clean trading — keep it up.</p>
      ) : (
        <div className="overflow-x-auto no-scrollbar -mx-1 px-1">
          <table className="w-full text-left table-auto">
            <thead>
              <tr className="text-[9px] font-black uppercase tracking-widest text-zinc-500 border-b border-zinc-800/80">
                <th className="py-2 pr-2 sm:pr-3 font-black min-w-0">Violation</th>
                <th className="py-2 px-1 sm:pr-3 font-black text-right whitespace-nowrap">Trades</th>
                <th className="py-2 px-1 sm:pr-3 font-black text-right whitespace-nowrap">Win%</th>
                <th className="py-2 px-1 sm:pr-3 font-black text-right whitespace-nowrap">Total P&L</th>
                <th className="py-2 pl-1 font-black text-right whitespace-nowrap">Avg P&L</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {rows.map((row) => (
                <tr key={row.tag}>
                  <td className="py-3 pr-2 sm:pr-3 text-[12px] sm:text-[13px] font-bold text-zinc-100 break-words min-w-0">{row.tag}</td>
                  <td className="py-3 px-1 sm:pr-3 text-[12px] sm:text-[13px] font-mono text-zinc-400 text-right whitespace-nowrap">{row.count}</td>
                  <td className="py-3 px-1 sm:pr-3 text-[12px] sm:text-[13px] font-mono text-zinc-400 text-right whitespace-nowrap">
                    {row.winRate === null ? '—' : `${row.winRate}%`}
                  </td>
                  <td className={`py-3 px-1 sm:pr-3 text-[12px] sm:text-[13px] font-black font-mono text-right whitespace-nowrap ${row.totalPnl < 0 ? 'text-[#ff4f64]' : 'text-emerald-400'}`}>
                    {fmtMoney(row.totalPnl, currencySymbol)}
                  </td>
                  <td className={`py-3 pl-1 text-[12px] sm:text-[13px] font-bold font-mono text-right whitespace-nowrap ${row.avgPnl < 0 ? 'text-[#ff4f64]/80' : 'text-emerald-400/80'}`}>
                    {fmtMoney(row.avgPnl, currencySymbol)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
