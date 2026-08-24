import React, { useMemo } from 'react';
import { Trade } from '../../types';
import { HelpCircle } from 'lucide-react';
import { Tooltip } from '../ui/Tooltip';
import { DivergingBarChart } from './DivergingBarChart';

const safePnL = (value: unknown): number => {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : 0;
};

interface PLByPlanAdherenceWidgetProps {
    trades: Trade[];
    isDarkMode: boolean;
    currencySymbol: string;
    onInfoClick?: () => void;
}

const BUCKETS = [
    { label: 'Followed Plan', key: 'Followed Exactly' },
    { label: 'Minor Deviation', key: 'Minor Deviation' },
    { label: 'Major Deviation', key: 'Major Deviation' },
    { label: 'No Plan', key: 'No Plan' },
] as const;

export const PLByPlanAdherenceWidget: React.FC<PLByPlanAdherenceWidgetProps> = ({ trades = [], isDarkMode, currencySymbol, onInfoClick }) => {
    const rows = useMemo(
        () =>
            BUCKETS.map((bucket) => {
                const filteredTrades = trades.filter((trade) => (trade.planAdherence || 'No Plan') === bucket.key);
                const total = filteredTrades.reduce((sum, trade) => sum + safePnL(trade.pnl), 0);
                return {
                    label: bucket.label,
                    value: Math.round(total * 100) / 100,
                    count: filteredTrades.length,
                };
            }),
        [trades]
    );

    return (
        <div className="bg-[#000000] rounded-[14px] shadow-[0_1px_2px_rgba(0,0,0,0.35)] p-6 border border-[#1f1f1f] flex flex-col pt-[20px]">
            <div className="flex items-center gap-2 mb-6">
                <h2 className="text-[18px] font-bold text-white">P/L by Plan Adherence</h2>
                <Tooltip content="Compares profitability across different levels of trading plan adherence." isDarkMode={true} onInfoClick={onInfoClick}>
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
