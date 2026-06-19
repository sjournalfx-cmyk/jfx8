import React, { useMemo, useState } from 'react';
import { Trade } from '../../types';
import { Table, LayoutGrid, Calendar, HelpCircle } from 'lucide-react';
import { Tooltip } from '../ui/Tooltip';

interface PerformanceMatrixWidgetProps {
    trades: Trade[];
    isDarkMode: boolean;
    currencySymbol: string;
}

type ViewMode = 'monthly' | 'weekly';

const getISOWeekNumber = (date: Date) => {
    const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNumber = target.getUTCDay() || 7;
    target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
    const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
    return Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
};

export const PerformanceMatrixWidget: React.FC<PerformanceMatrixWidgetProps> = ({ trades, isDarkMode, currencySymbol }) => {
    const [viewMode, setViewMode] = useState<ViewMode>('monthly');

    const months = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const weeks = Array.from({ length: 53 }, (_, i) => `W${i + 1}`);

    const currentYear = new Date().getFullYear();

    const matrixData = useMemo(() => {
        const symbols = Array.from(new Set(trades.map(t => t.pair.toUpperCase()))).sort();
        const data: Record<string, number[]> = {};
        const columnCount = viewMode === 'monthly' ? 12 : 53;

        symbols.forEach(symbol => {
            data[symbol] = Array(columnCount).fill(0);
        });

        trades.forEach(trade => {
            const tradeDate = new Date(trade.date);
            if (tradeDate.getFullYear() !== currentYear) return;

            const columnIdx = viewMode === 'monthly'
                ? tradeDate.getMonth()
                : Math.max(0, Math.min(52, getISOWeekNumber(tradeDate)) - 1);
            const symbol = trade.pair.toUpperCase();

            if (data[symbol]) {
                data[symbol][columnIdx] += trade.pnl;
            }
        });

        return { symbols, data };
    }, [trades, currentYear, viewMode]);

    const columns = viewMode === 'monthly' ? months : weeks;

    const getBgColor = (val: number) => {
        if (val === 0) return '';
        if (val > 0) {
            if (val > 5000) return isDarkMode ? 'rgba(16, 185, 129, 0.6)' : '#6ee7b7';
            if (val > 1000) return isDarkMode ? 'rgba(16, 185, 129, 0.4)' : '#a7f3d0';
            return isDarkMode ? 'rgba(16, 185, 129, 0.2)' : '#d1fae5';
        }
        if (Math.abs(val) > 5000) return isDarkMode ? 'rgba(244, 63, 94, 0.6)' : '#fda4af';
        if (Math.abs(val) > 1000) return isDarkMode ? 'rgba(244, 63, 94, 0.4)' : '#fecdd3';
        return isDarkMode ? 'rgba(244, 63, 94, 0.2)' : '#ffe4e6';
    };

    const getTextColor = (val: number) => {
        if (val === 0) return isDarkMode ? 'text-zinc-600' : 'text-slate-300';
        if (val > 0) return isDarkMode ? 'text-emerald-400' : 'text-emerald-700';
        return isDarkMode ? 'text-rose-400' : 'text-rose-700';
    };

    return (
        <div className={`w-full overflow-hidden rounded-[32px] border ${isDarkMode ? 'bg-black border-zinc-800' : 'bg-white border-slate-200 shadow-md'}`}>
            <div className="p-6 border-b border-zinc-500/10 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-500">
                        <Table size={20} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="text-lg font-bold tracking-tight">Symbol Performance Matrix</h3>
                            <Tooltip content="Monthly or weekly P/L breakdown per symbol. Green = profitable period, Red = losing period." isDarkMode={isDarkMode}>
                                <HelpCircle size={13} className="opacity-40 cursor-help hover:opacity-100" />
                            </Tooltip>
                        </div>
                        <p className="text-[10px] uppercase font-black tracking-widest opacity-40">
                            {viewMode === 'monthly' ? 'Monthly Breakdown' : 'Weekly Breakdown'} - {currentYear}
                        </p>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={() => setViewMode((prev) => (prev === 'monthly' ? 'weekly' : 'monthly'))}
                    className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[10px] font-black uppercase tracking-widest ${
                        isDarkMode ? 'border-zinc-800 bg-black/80 text-zinc-200 hover:border-zinc-700' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                    }`}
                    aria-pressed={viewMode === 'weekly'}
                    title={viewMode === 'monthly' ? 'Switch to weekly view' : 'Switch to monthly view'}
                >
                    {viewMode === 'monthly' ? <LayoutGrid size={14} /> : <Calendar size={14} />}
                    {viewMode === 'monthly' ? 'Weeks' : 'Months'}
                </button>
            </div>

            <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full border-collapse text-left">
                    <thead>
                        <tr className={`${isDarkMode ? 'bg-black/80' : 'bg-slate-50'}`}>
                            <th className="p-4 text-[10px] font-black uppercase tracking-widest opacity-40 border-b border-zinc-500/10 sticky left-0 z-30 bg-inherit min-w-[140px]">Instrument</th>
                            {columns.map((label) => (
                                <th
                                    key={label}
                                    className={`p-4 text-[10px] font-black uppercase tracking-widest opacity-40 border-b border-zinc-500/10 text-center ${
                                        viewMode === 'monthly' ? 'min-w-[110px]' : 'min-w-[72px]'
                                    }`}
                                >
                                    {label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className={`divide-y ${isDarkMode ? 'divide-zinc-800' : 'divide-slate-100'}`}>
                        {matrixData.symbols.map(symbol => (
                            <tr key={symbol} className="group">
                                <td className={`p-4 text-[11px] font-black sticky left-0 z-20 border-r ${isDarkMode ? 'bg-black text-white border-zinc-800' : 'bg-white text-slate-900 border-slate-100'}`}>{symbol}</td>
                                {matrixData.data[symbol].map((val, i) => (
                                    <td
                                        key={i}
                                        className="p-4 text-center text-[11px] font-mono font-bold border-r last:border-r-0 border-zinc-500/5"
                                        style={{ backgroundColor: getBgColor(val) }}
                                    >
                                        <span className={getTextColor(val)}>
                                            {val === 0 ? '$0' : (val > 0 ? '+' : '-') + currencySymbol + Math.abs(val).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                        </span>
                                    </td>
                                ))}
                            </tr>
                        ))}
                        {matrixData.symbols.length === 0 && (
                            <tr>
                                <td colSpan={columns.length + 1} className="p-12 text-center opacity-30 text-xs font-bold uppercase tracking-widest">No trade data available for {currentYear}</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
