import React, { useMemo, useState } from 'react';
import { Trade } from '../../types';
import { HelpCircle } from 'lucide-react';
import { Tooltip } from '../ui/Tooltip';

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

interface TooltipState {
    visible: boolean;
    x: number;
    y: number;
    label: string;
    value: number;
    count: number;
}

export const PLByPlanAdherenceWidget: React.FC<PLByPlanAdherenceWidgetProps> = ({ trades = [], isDarkMode, currencySymbol }) => {
    const [tooltip, setTooltip] = useState<TooltipState>({ visible: false, x: 0, y: 0, label: '', value: 0, count: 0 });

    const chart = useMemo(() => {
        const values = BUCKETS.map((bucket) => {
            const filteredTrades = trades.filter((trade) => (trade.planAdherence || 'No Plan') === bucket.key);
            const total = filteredTrades.reduce((sum, trade) => sum + safePnL(trade.pnl), 0);
            return {
                label: bucket.label,
                value: Math.round(total * 100) / 100,
                count: filteredTrades.length,
            };
        });

        const max = Math.max(5, ...values.map((item) => item.value));
        const min = Math.min(-5, ...values.map((item) => item.value));
        const roundedMax = Math.ceil(max / 5) * 5;
        const roundedMin = Math.floor(min / 5) * 5;
        const range = roundedMax - roundedMin || 10;
        const ticks = Array.from({ length: 11 }, (_, index) => roundedMax - ((roundedMax - roundedMin) / 10) * index);
        const zeroY = (roundedMax / range) * 100;

        return { values, ticks, roundedMax, roundedMin, range, zeroY };
    }, [trades]);

    return (
        <div className="bg-[#000000] rounded-[14px] shadow-[0_1px_2px_rgba(0,0,0,0.35)] p-6 border border-[#1f1f1f] flex flex-col pt-[20px]">
            <div className="flex items-center gap-2 mb-6">
                <h2 className="text-[18px] font-bold text-white">P/L by Plan Adherence</h2>
                <Tooltip content="Compares profitability across different levels of trading plan adherence." isDarkMode={true}>
                    <HelpCircle size={14} className="opacity-40 cursor-help hover:opacity-100 text-white" />
                </Tooltip>
            </div>

            <div className="relative flex-1 min-h-[280px]">
                <div className="absolute inset-0 flex items-end justify-around px-4 pb-10">
                    {chart.ticks.map((tick) => (
                        <div
                            key={tick}
                            className="absolute left-0 right-0 border-t border-[#141414]"
                            style={{ top: `${((chart.roundedMax - tick) / chart.range) * 100}%` }}
                        />
                    ))}
                    <div
                        className="absolute left-0 right-0 border-t border-[#2a2a2a]"
                        style={{ top: `${chart.zeroY}%` }}
                    />

                    {chart.values.map((item, index) => {
                        const height = `${Math.max((Math.abs(item.value) / chart.range) * 100, 0)}%`;
                        const isPositive = item.value >= 0;
                        return (
                            <div key={item.label} className="relative flex h-full w-full max-w-[120px] items-end justify-center">
                                <div
                                    className={`${isPositive ? 'bg-[#7ae2b1]/20 border-[#7ae2b1]/30' : index === 2 ? 'bg-[#fcbba4]/20 border-[#fcbba4]/30' : 'bg-[#c0c5cc]/20 border-[#c0c5cc]/30'} w-[68%] cursor-pointer backdrop-blur-xl border-b border-t border-t-white/[0.06] transition-all hover:opacity-90 hover:brightness-125`}
                                    style={{
                                        height,
                                        position: 'absolute',
                                        bottom: isPositive ? `${100 - chart.zeroY}%` : 'auto',
                                        top: isPositive ? 'auto' : `${chart.zeroY}%`,
                                    }}
                                    onMouseEnter={(e) => {
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        setTooltip({ visible: true, x: rect.left + rect.width / 2, y: rect.top, label: item.label, value: item.value, count: item.count });
                                    }}
                                    onMouseLeave={() => setTooltip((prev) => ({ ...prev, visible: false }))}
                                />
                                <span className="absolute -bottom-10 text-center text-[14px] text-[#c0c5cc] leading-5">
                                    {item.label}
                                </span>
                            </div>
                        );
                    })}
                </div>
                {tooltip.visible && (
                    <div
                        className="fixed z-50 bg-[#000000] border border-[#27272a] rounded-xl px-4 py-3 shadow-xl pointer-events-none"
                        style={{ left: tooltip.x, top: tooltip.y - 10, transform: 'translate(-50%, -100%)' }}
                    >
                        <div className="text-[14px] font-semibold text-white mb-1">{tooltip.label}</div>
                        <div className="text-[13px] text-[#c0c5cc]">{tooltip.count} trade{tooltip.count !== 1 ? 's' : ''}</div>
                        <div className={`text-[16px] font-bold ${tooltip.value >= 0 ? 'text-[#7ae2b1]' : 'text-[#ef4444]'}`}>
                            {tooltip.value >= 0 ? '+' : ''}{currencySymbol}{tooltip.value.toFixed(2)}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
