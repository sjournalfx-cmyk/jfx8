import React, { useMemo } from 'react';
import { Trade } from '../../types';
import { BarChart3 } from 'lucide-react';

interface SymbolPerformanceWidgetProps {
    trades: Trade[];
    isDarkMode: boolean;
    currencySymbol: string;
    onInfoClick?: () => void;
}

export const SymbolPerformanceWidget: React.FC<SymbolPerformanceWidgetProps> = ({ trades = [], isDarkMode, currencySymbol = '$', onInfoClick }) => {
    const symbolStats = useMemo(() => {
        const safeTrades = trades || [];
        const stats: Record<string, { totalPnl: number; count: number }> = {};
        safeTrades.forEach(trade => {
            if (!trade.pair) return;
            const symbol = trade.pair.toUpperCase();
            if (!stats[symbol]) stats[symbol] = { totalPnl: 0, count: 0 };
            stats[symbol].totalPnl += trade.pnl || 0;
            stats[symbol].count += 1;
        });
        const symbolList = Object.entries(stats).map(([symbol, data]) => ({
            symbol,
            sum: data.totalPnl,
            avg: data.count > 0 ? data.totalPnl / data.count : 0
        }));
        const sortedBySum = [...symbolList].sort((a, b) => b.sum - a.sum);
        const sortedByAvg = [...symbolList].sort((a, b) => b.avg - a.avg);
        return {
            bestSymbolSum: sortedBySum[0] || null,
            worstSymbolSum: sortedBySum[sortedBySum.length - 1] || null,
            bestSymbolAvg: sortedByAvg[0] || null,
            worstSymbolAvg: sortedByAvg[sortedByAvg.length - 1] || null,
        };
    }, [trades]);

    const cards = [
        { label: 'Best Symbol Sum', data: symbolStats.bestSymbolSum },
        { label: 'Worst Symbol Sum', data: symbolStats.worstSymbolSum },
        { label: 'Best Symbol Avg', data: symbolStats.bestSymbolAvg },
        { label: 'Worst Symbol Avg', data: symbolStats.worstSymbolAvg },
    ];

    return (
        <div className={`py-4 px-0 sm:p-6 rounded-none sm:rounded-[24px] border h-full ${isDarkMode ? 'bg-black border-zinc-800' : 'bg-white border-slate-200 shadow-md'}`}>
            <div className="flex items-center gap-3 mb-6">
                <div className={`p-2 rounded-xl ${isDarkMode ? 'bg-black' : 'bg-slate-100'} text-indigo-500`}>
                    <BarChart3 size={20} />
                </div>
                <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold tracking-tight">Symbol Performance</h3>
                </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {cards.map((card, i) => (
                    <div key={i} className={`p-4 rounded-xl border ${isDarkMode ? 'bg-[#000000] border-zinc-700/50' : 'bg-slate-50 border-slate-200'}`}>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-bold uppercase tracking-wider opacity-50">{card.label}</span>
                        </div>
                        <div className="text-xl font-black mb-1">{card.data?.symbol || '---'}</div>
                        <div className={`text-sm font-mono font-bold ${card.data && (card.label.includes('Sum') ? card.data.sum >= 0 : card.data.avg >= 0) ? 'text-emerald-500' : 'text-rose-500'}`}>
                            {card.data ? (card.label.includes('Sum') ? `${currencySymbol}${card.data.sum.toFixed(2)}` : `${currencySymbol}${card.data.avg.toFixed(2)}`) : '---'}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
