import React from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';

export interface DivergingBarRow {
    label: string;
    value: number;
    count: number;
}

interface DivergingBarChartProps {
    rows: DivergingBarRow[];
    currencySymbol: string;
}

const formatPnL = (value: number, currencySymbol: string): string => {
    const sign = value > 0 ? '+' : '';
    return `${sign}${currencySymbol}${value.toFixed(2)}`;
};

export const DivergingBarChart: React.FC<DivergingBarChartProps> = ({ rows, currencySymbol }) => {
    const maxAbs = Math.max(1, ...rows.map((row) => Math.abs(row.value)));

    const best = rows.reduce((acc, row) => (row.value > acc.value ? row : acc), rows[0]);
    const worst = rows.reduce((acc, row) => (row.value < acc.value ? row : acc), rows[0]);

    return (
        <div className="flex flex-col">
            <div className="relative divide-y divide-[#161616]">
                <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[#262626]" />

                {rows.map((row) => {
                    const ratio = Math.abs(row.value) / maxAbs;
                    const width = `${ratio * 50}%`;
                    const isPositive = row.value >= 0;

                    return (
                        <div key={row.label} className="group grid grid-cols-[120px_1fr_120px] items-center py-[9px]">
                            <span
                                className="truncate pr-3 text-[13px] text-[#c0c5cc] transition-colors group-hover:text-white"
                                title={row.label}
                            >
                                {row.label}
                            </span>

                            <div className="relative h-[18px]">
                                {row.value !== 0 && (
                                    <div
                                        className={`absolute top-1/2 h-[13px] -translate-y-1/2 cursor-default transition-all duration-200 group-hover:brightness-125 ${
                                            isPositive ? 'rounded-r-full' : 'rounded-l-full'
                                        }`}
                                        style={{
                                            width,
                                            minWidth: 6,
                                            [isPositive ? 'left' : 'right']: '50%',
                                            background: isPositive
                                                ? 'linear-gradient(90deg, rgba(122,226,177,0.3), rgba(122,226,177,0.95))'
                                                : 'linear-gradient(270deg, rgba(239,68,68,0.3), rgba(239,68,68,0.95))',
                                            boxShadow: isPositive
                                                ? '0 0 10px rgba(122,226,177,0.18)'
                                                : '0 0 10px rgba(239,68,68,0.18)',
                                        }}
                                    />
                                )}
                            </div>

                            <div className="pl-3 text-right leading-tight">
                                <div
                                    className={`text-[13px] font-semibold ${
                                        row.value > 0 ? 'text-[#7ae2b1]' : row.value < 0 ? 'text-[#ef4444]' : 'text-[#71717a]'
                                    }`}
                                >
                                    {formatPnL(row.value, currencySymbol)}
                                </div>
                                <div className="text-[11px] text-[#71717a]">
                                    {row.count} trade{row.count !== 1 ? 's' : ''}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="mt-3 flex items-center justify-between gap-4 border-t border-[#1f1f1f] pt-3">
                <div className="flex items-center gap-1.5">
                    <TrendingUp size={13} className="text-[#7ae2b1]" />
                    <span className="text-[12px] text-[#71717a]">Best</span>
                    <span className="text-[12px] font-semibold text-white">{best.label}</span>
                    <span className="text-[12px] font-semibold text-[#7ae2b1]">{formatPnL(best.value, currencySymbol)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <TrendingDown size={13} className="text-[#ef4444]" />
                    <span className="text-[12px] text-[#71717a]">Worst</span>
                    <span className="text-[12px] font-semibold text-white">{worst.label}</span>
                    <span className="text-[12px] font-semibold text-[#ef4444]">{formatPnL(worst.value, currencySymbol)}</span>
                </div>
            </div>
        </div>
    );
};
