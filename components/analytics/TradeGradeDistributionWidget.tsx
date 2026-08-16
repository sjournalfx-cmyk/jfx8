import React, { useMemo } from 'react';
import { Trade } from '../../types';
import { Star, HelpCircle } from 'lucide-react';
import { Tooltip } from '../ui/Tooltip';

interface TradeGradeDistributionProps {
    trades: Trade[];
    isDarkMode: boolean;
    onInfoClick?: () => void;
}

export const TradeGradeDistributionWidget: React.FC<TradeGradeDistributionProps> = ({ trades, isDarkMode, onInfoClick }) => {
    const distribution = useMemo(() => {
        const counts = [0, 0, 0, 0, 0]; // 1-5 stars
        trades.forEach(t => {
            const rating = Math.round(t.rating || 0);
            if (rating >= 1 && rating <= 5) {
                counts[rating - 1]++;
            }
        });
        const max = Math.max(...counts, 1);
        return counts.map((count, i) => ({
            stars: i + 1,
            count,
            percentage: (count / max) * 100
        }));
    }, [trades]);

    return (
        <div className={`p-6 rounded-[32px] border flex flex-col h-full ${isDarkMode ? 'bg-black border-zinc-800' : 'bg-white border-slate-200 shadow-sm'}`}>
            <div className="flex items-center gap-2 mb-6">
                <Star size={16} className="text-amber-500 opacity-80" />
                <h3 className="text-sm font-black uppercase tracking-widest opacity-80">Trade Grade Distribution</h3>
                <Tooltip content="Distribution of your self-rated trade quality scores from 1 to 5 stars." isDarkMode={isDarkMode}>
                    <HelpCircle size={13} className="opacity-40 cursor-help hover:opacity-100" />
                </Tooltip>
            </div>

            <div className="flex-1 flex flex-col justify-between gap-3">
                {distribution.slice().reverse().map((d) => (
                    <div key={d.stars} className="space-y-1">
                        <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-tighter">
                            <div className="flex items-center gap-1 opacity-40">
                                {Array.from({ length: d.stars }).map((_, i) => (
                                    <Star key={i} size={8} fill="currentColor" />
                                ))}
                            </div>
                            <span className="opacity-60">{d.count} Trades</span>
                        </div>
                        <div className="h-2 w-full bg-black/5 dark:bg-white/5 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-amber-500"
                                style={{ width: `${d.percentage}%` }}
                            />
                        </div>
                    </div>
                ))}
            </div>

        </div>
    );
};
