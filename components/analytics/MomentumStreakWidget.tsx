import React, { useMemo } from 'react';
import { Trade } from '../../types';
import { HelpCircle } from 'lucide-react';
import { Tooltip } from '../ui/Tooltip';

interface MomentumStreakWidgetProps {
    trades: Trade[];
    isDarkMode: boolean;
}

export const MomentumStreakWidget: React.FC<MomentumStreakWidgetProps> = ({ trades = [], isDarkMode }) => {
    const stats = useMemo(() => {
        const sortedTrades = [...trades].sort((a, b) => new Date(`${a.date}T${a.time || '00:00'}`).getTime() - new Date(`${b.date}T${b.time || '00:00'}`).getTime());

        const groupedRecent: { result: string }[] = [];
        let j = 0;
        while (j < sortedTrades.length) {
            const current = sortedTrades[j];
            const setupId = current.setupId;
            const result = current.result;

            if (setupId) {
                let count = 1;
                while (j + count < sortedTrades.length && 
                       sortedTrades[j + count].setupId === setupId && 
                       sortedTrades[j + count].result === result) {
                    count++;
                }
                groupedRecent.push({ result });
                j += count;
            } else {
                groupedRecent.push({ result });
                j++;
            }
        }

        let longestWin = 0;
        let longestLoss = 0;
        let tempWin = 0;
        let tempLoss = 0;

        groupedRecent.forEach(item => {
            if (item.result === 'Win') {
                tempWin++;
                tempLoss = 0;
                if (tempWin > longestWin) longestWin = tempWin;
            } else if (item.result === 'Loss') {
                tempLoss++;
                tempWin = 0;
                if (tempLoss > longestLoss) longestLoss = tempLoss;
            } else {
                tempWin = 0;
                tempLoss = 0;
            }
        });

        let currentStreakValue = 0;
        let currentStreakType: string | null = null;

        const lastGroups = [...groupedRecent].reverse();
        if (lastGroups.length > 0) {
            currentStreakType = lastGroups[0].result;
            for (const item of lastGroups) {
                if (item.result === currentStreakType) {
                    currentStreakValue++;
                } else {
                    break;
                }
            }
        }

        return { 
            longestWin, 
            longestLoss, 
            currentStreakType, 
            currentStreakValue, 
            recent: groupedRecent.slice(-12) 
        };
    }, [trades]);

    return (
        <div className={`p-4 rounded-[20px] border h-full flex flex-col ${isDarkMode ? 'bg-[#000000] border-zinc-800' : 'bg-white border-slate-200 shadow-md'}`}>
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest opacity-40">Streak</span>
                    <Tooltip content="Shows your current win/loss streak and your all-time longest winning and losing runs." isDarkMode={isDarkMode}>
                        <HelpCircle size={12} className="opacity-40 cursor-help hover:opacity-100" />
                    </Tooltip>
                </div>
                <div className="flex gap-3 text-[9px] font-bold uppercase tracking-wider">
                    <span className="opacity-40">Max</span>
                    <span className="text-emerald-500">{stats.longestWin}W</span>
                    <span className="text-rose-500">{stats.longestLoss}L</span>
                </div>
            </div>

            <div className="flex-1 flex items-center justify-center gap-4">
                <div className="flex gap-1">
                    {stats.recent.slice(0, 10).map((item, i) => (
                        <div
                            key={i}
                            className={`w-2.5 h-2.5 rounded-full ${item.result === 'Win' ? 'bg-emerald-500' : item.result === 'Loss' ? 'bg-rose-500' : 'bg-zinc-500 opacity-30'}`}
                        />
                    ))}
                </div>

                <div className="text-4xl font-black tabular-nums">
                    <span className={stats.currentStreakType === 'Win' ? 'text-emerald-500' : stats.currentStreakType === 'Loss' ? 'text-rose-500' : 'opacity-30'}>
                        {stats.currentStreakValue}
                    </span>
                </div>
            </div>
        </div>
    );
};
