import React, { useMemo } from 'react';
import { Trade } from '../../types';

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
        <div className={`p-4 sm:p-6 rounded-2xl sm:rounded-[24px] border-0 h-full ${isDarkMode ? 'bg-black' : 'bg-white shadow-md'}`}>
            <div className="mb-3 sm:mb-4 min-w-0">
                <h3 className="text-[15px] font-semibold tracking-tight text-left">Symbol Performance</h3>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                {cards.map((card, i) => (
                    <div key={i} className={`p-3 sm:p-4 rounded-xl border-0 min-w-0 bg-[#0a0a0a] text-white`}>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-bold uppercase tracking-wider leading-tight opacity-50">{card.label}</span>
                        </div>
                        <div className="text-lg sm:text-xl font-black mb-1 truncate">{card.data?.symbol || '---'}</div>
                        <div className={`text-sm font-mono font-bold ${card.data && (card.label.includes('Sum') ? card.data.sum >= 0 : card.data.avg >= 0) ? 'text-emerald-500' : 'text-rose-500'}`}>
                            {card.data ? (card.label.includes('Sum') ? `${currencySymbol}${card.data.sum.toFixed(2)}` : `${currencySymbol}${card.data.avg.toFixed(2)}`) : '---'}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
