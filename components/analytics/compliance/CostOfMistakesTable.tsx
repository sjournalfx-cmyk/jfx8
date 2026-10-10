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
  `${v < 0 ? '-' : v > 0 ? '+' : ''}${sym}${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const CostOfMistakesTable: React.FC<CostOfMistakesTableProps> = ({
  trades,
  isDarkMode,
  currencySymbol,
  onInfoClick,
}) => {
  const rows = useMemo(() => costOfViolations(trades), [trades]);

  return (
    <div className="bg-[#0a0a0a] text-white rounded-[14px] p-6 border-0 flex flex-col">
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
          <table className="w-full text-left min-w-[520px]">
            <thead>
              <tr className="text-[9px] font-black uppercase tracking-widest text-zinc-500 border-b border-zinc-800/80">
                <th className="py-2 pr-3 font-black">Violation</th>
                <th className="py-2 pr-3 font-black text-right">Trades</th>
                <th className="py-2 pr-3 font-black text-right">Win%</th>
                <th className="py-2 pr-3 font-black text-right">Total P&L</th>
                <th className="py-2 font-black text-right">Avg P&L</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {rows.map((row) => (
                <tr key={row.tag}>
                  <td className="py-3 pr-3 text-[13px] font-bold text-zinc-100">{row.tag}</td>
                  <td className="py-3 pr-3 text-[13px] font-mono text-zinc-400 text-right">{row.count}</td>
                  <td className="py-3 pr-3 text-[13px] font-mono text-zinc-400 text-right">
                    {row.winRate === null ? '—' : `${row.winRate}%`}
                  </td>
                  <td className={`py-3 pr-3 text-[13px] font-black font-mono text-right ${row.totalPnl < 0 ? 'text-[#ff4f64]' : 'text-emerald-400'}`}>
                    {fmtMoney(row.totalPnl, currencySymbol)}
                  </td>
                  <td className={`py-3 text-[13px] font-bold font-mono text-right ${row.avgPnl < 0 ? 'text-[#ff4f64]/80' : 'text-emerald-400/80'}`}>
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
