import React, { useMemo } from 'react';
import { Trade } from '../../types';
import { HelpCircle } from 'lucide-react';
import { Tooltip } from '../ui/Tooltip';
import { DivergingBarChart } from './DivergingBarChart';

const safePnL = (value: unknown): number => {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : 0;
};

interface PLByMindsetWidgetProps {
    trades: Trade[];
    isDarkMode: boolean;
    currencySymbol: string;
    onInfoClick?: () => void;
}

const MINDSETS = ['Confident', 'Neutral', 'Hesitant', 'Anxious', 'FOMO'];

export const PLByMindsetWidget: React.FC<PLByMindsetWidgetProps> = ({ trades = [], isDarkMode, currencySymbol, onInfoClick }) => {
    const rows = useMemo(
        () =>
            MINDSETS.map((mindset) => {
                const filteredTrades = trades.filter((trade) => (trade.mindset || 'Neutral') === mindset);
                const total = filteredTrades.reduce((sum, trade) => sum + safePnL(trade.pnl), 0);
                return {
                    label: mindset,
                    value: Math.round(total * 100) / 100,
                    count: filteredTrades.length,
                };
            }),
        [trades]
    );

    return (
        <div className="bg-[#000000] rounded-[14px] shadow-[0_1px_2px_rgba(0,0,0,0.35)] p-6 border border-[#1f1f1f] flex flex-col pt-[20px]">
            <div className="flex items-center gap-2 mb-6">
                <h2 className="text-[18px] font-bold text-white">P/L by Mindset</h2>
                <Tooltip content="Shows total profit or loss grouped by your emotional state at the time of each trade." isDarkMode={true} onInfoClick={onInfoClick}>
                    <HelpCircle size={14} className="opacity-40 cursor-help hover:opacity-100 text-white" />
                </Tooltip>
            </div>

            <div className="flex flex-1 flex-col justify-center min-h-[280px]">
                {trades.length === 0 ? (
                    <p className="text-center text-[14px] text-[#71717a]">No completed trades yet.</p>
                ) : (
                    <DivergingBarChart rows={rows} currencySymbol={currencySymbol} />
                )}
            </div>
        </div>
    );
};
