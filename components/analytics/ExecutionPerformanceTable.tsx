import React, { useMemo, useState } from 'react';
import { 
    Pencil,
    Check,
    X
} from 'lucide-react';
import { Trade } from '../../types';
import { dataService } from '../../services/dataService';
import { sortTradesChronologically } from '../../lib/analyticsUtils';

interface ExecutionPerformanceTableProps {
    trades: Trade[];
    isDarkMode: boolean;
    currencySymbol?: string;
    initialBalance: number;
}

export const ExecutionPerformanceTable: React.FC<ExecutionPerformanceTableProps> = ({ trades = [], isDarkMode, currencySymbol = '$', initialBalance = 0 }) => {
    const stripHtml = (html: string) => {
        if (!html) return "All Rules";
        const text = html.replace(/<[^>]*>?/gm, '').trim();
        return text || "All Rules";
    };

    const getCommentColor = (text: string) => {
        if (text.toLowerCase() === 'all rules') return 'text-emerald-500';
        return '';
    };

    const [editingTrade, setEditingTrade] = useState<{ id: string, field: 'notes' | 'exitComment', value: string } | null>(null);

    const handleSave = async (id: string, field: 'notes' | 'exitComment', value: string) => {
        if (value.trim() === '') return;

        try {
            const tradeToUpdate = trades.find(t => t.id === id);
            if (!tradeToUpdate) throw new Error("Trade not found");

            const updatedTrade = {
                ...tradeToUpdate,
                [field]: value
            };

            await dataService.updateTrade(updatedTrade);
            setEditingTrade(null);
        } catch (error) {
            console.error("Error saving trade update:", error);
        }
    };

    const EditField = ({ id, field, value, onSave }: { id: string, field: 'notes' | 'exitComment', value: string, onSave: (val: string) => void }) => {
        const [tempValue, setTempValue] = useState(value);
        return (
            <div className="flex items-center gap-2">
                <input
                    className={`text-xs font-bold w-full bg-transparent border-b ${isDarkMode ? 'border-zinc-700 text-white' : 'border-slate-300 text-slate-900'} outline-none`}
                    value={tempValue}
                    onChange={(e) => setTempValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && onSave(tempValue)}
                    autoFocus
                />
                <button onClick={() => onSave(tempValue)} className="text-emerald-500"><Check size={12} /></button>
                <button onClick={() => setEditingTrade(null)} className="text-rose-500"><X size={12} /></button>
            </div>
        );
    };

    const sortedTrades = useMemo(() => {
        const safeTrades = trades || [];
        return sortTradesChronologically(safeTrades).slice(0, 15);
    }, [trades]);

    return (
        <div className={`rounded-none sm:rounded-[24px] overflow-hidden border-y sm:border h-full ${isDarkMode ? 'bg-black border-zinc-800' : 'bg-white border-slate-200 shadow-sm'}`}>
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className={`text-[10px] font-bold uppercase tracking-widest opacity-40 ${isDarkMode ? 'bg-black/50 text-zinc-500' : 'bg-slate-50 text-slate-400'}`}>
                            <th className="px-6 py-5 font-bold">Tiltmeter</th>
                            <th className="px-6 py-5 font-bold">Entry Comment</th>
                            <th className="px-6 py-5 font-bold">Exit Comment</th>
                            <th className="px-6 py-5 text-right font-bold">Return (%)</th>
                        </tr>
                    </thead>
                    <tbody className={`divide-y ${isDarkMode ? 'divide-white/5' : 'divide-slate-100'}`}>
                        {sortedTrades.map((trade) => {
                            const pnl = Number.isFinite(Number(trade.pnl)) ? Number(trade.pnl) : 0;
                            const returnPercent = initialBalance > 0 ? (pnl / initialBalance) * 100 : 0;
                            const isWin = pnl > 0;
                            const absReturn = Math.abs(returnPercent);
                            const barWidth = Math.min(40, absReturn * 2);

                            const entryComment = stripHtml(trade.notes || "");
                            const exitComment = stripHtml(trade.exitComment || "");

                            return (
                                <tr key={trade.id} className={`group ${isDarkMode ? 'hover:bg-white/[0.02]' : 'hover:bg-slate-50'}`}>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center">
                                            <div className="relative flex items-center h-4 w-20 justify-center">
                                                <div className={`absolute w-1.5 h-4 rounded-full z-10 ${isDarkMode ? 'bg-black' : 'bg-slate-300'}`} />
                                                <div
                                                    className={`absolute h-1.5 rounded-full ${isWin ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]' : 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.4)]'}`}
                                                    style={{
                                                        width: `${barWidth}px`,
                                                        left: isWin ? '50%' : 'auto',
                                                        right: isWin ? 'auto' : '50%',
                                                        transform: isWin ? 'translateX(4px)' : 'translateX(-4px)'
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 group/comment">
                                        {editingTrade?.id === trade.id && editingTrade.field === 'notes' ? (
                                            <EditField id={trade.id} field="notes" value={editingTrade.value} onSave={(val) => handleSave(trade.id, 'notes', val)} />
                                        ) : (
                                            <div className="flex items-center gap-2">
                                                <div className={`text-xs font-bold ${getCommentColor(entryComment)}`}>
                                                    {entryComment}
                                                </div>
                                                <button 
                                                    title="Edit Entry Comment"
                                                    onClick={() => setEditingTrade({ id: trade.id, field: 'notes', value: trade.notes || '' })}
                                                    className={`opacity-0 group-hover/comment:opacity-100 p-1 rounded-lg ${isDarkMode ? 'hover:bg-black text-zinc-500' : 'hover:bg-slate-200 text-slate-400'}`}>
                                                    <Pencil size={12} />
                                                </button>
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 group/comment">
                                        {editingTrade?.id === trade.id && editingTrade.field === 'exitComment' ? (
                                            <EditField id={trade.id} field="exitComment" value={editingTrade.value} onSave={(val) => handleSave(trade.id, 'exitComment', val)} />
                                        ) : (
                                            <div className="flex items-center gap-2">
                                                <div className={`text-xs font-bold ${getCommentColor(exitComment)}`}>
                                                    {exitComment}
                                                </div>
                                                <button 
                                                    title="Edit Exit Comment"
                                                    onClick={() => setEditingTrade({ id: trade.id, field: 'exitComment', value: trade.exitComment || '' })}
                                                    className={`opacity-0 group-hover/comment:opacity-100 p-1 rounded-lg ${isDarkMode ? 'hover:bg-black text-zinc-500' : 'hover:bg-slate-200 text-slate-400'}`}>
                                                    <Pencil size={12} />
                                                </button>
                                            </div>
                                        )}
                                    </td>
                                    <td className={`px-6 py-4 text-right text-xs font-mono font-black ${isWin ? 'text-emerald-500' : 'text-rose-500'}`}>
                                        {returnPercent.toFixed(2)}%
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
