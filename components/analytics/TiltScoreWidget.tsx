import React, { useMemo } from 'react';
import { Trade } from '../../types';
import { calculateDisciplineScore, getDisciplineScoreLabel } from '../../lib/disciplineScore';

interface TiltScoreWidgetProps {
    trades: Trade[];
    isDarkMode: boolean;
    onInfoClick?: () => void;
}

export const TiltScoreWidget: React.FC<TiltScoreWidgetProps> = ({ trades = [], isDarkMode }) => {
    const scoreData = useMemo(() => {
        const score = calculateDisciplineScore(trades);
        if (score === null) {
            return {
                score: 78,
                label: 'Good',
                message: 'Your discipline is developing well. Focus on maintaining consistency in your trading approach.',
            };
        }

        let label = getDisciplineScoreLabel(score);
        let message = 'Your discipline is developing well. Focus on maintaining consistency in your trading approach.';

        if (score >= 90) {
            label = 'Excellent';
            message = 'Your rule-following is strong. Keep protecting that consistency.';
        } else if (score < 60) {
            label = 'Needs Work';
            message = 'Your discipline is inconsistent. Tighten your process before adding size.';
        } else if (score < 75) {
            label = 'Developing';
            message = 'Your discipline is improving, but emotional execution is still leaking returns.';
        }

        return { score, label, message };
    }, [trades]);

    const circumference = 2 * Math.PI * 42;
    const dashOffset = circumference - (scoreData.score / 100) * circumference;

    return (
        <div className={`rounded-[18px] border p-7 ${isDarkMode ? 'border-zinc-800 bg-black' : 'border-slate-200 bg-white shadow-sm'}`}>
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h2 className={`text-[28px] font-bold tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-950'}`}>
                        Trading Discipline
                    </h2>
                    <div className={`mt-8 text-[18px] font-bold ${isDarkMode ? 'text-white' : 'text-slate-950'}`}>
                        Tilt Score
                    </div>
                </div>

                <div className="mt-8 flex items-center gap-3">
                    <span className={`text-[16px] ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>Score</span>
                    <span className={`relative block h-8 w-14 rounded-full ${isDarkMode ? 'bg-black' : 'bg-slate-200'}`}>
                        <span className={`absolute left-1 top-1 h-6 w-6 rounded-full ${isDarkMode ? 'bg-zinc-600' : 'bg-white shadow-sm'}`} />
                    </span>
                </div>
            </div>

            <div className="mt-6 flex flex-col items-center text-center">
                <div className="relative h-[240px] w-[240px]">
                    <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                        <circle
                            cx="50"
                            cy="50"
                            r="42"
                            fill="transparent"
                            stroke={isDarkMode ? '#18181b' : '#f3f4f6'}
                            strokeWidth="8"
                        />
                        <circle
                            cx="50"
                            cy="50"
                            r="42"
                            fill="transparent"
                            stroke="#3b82f6"
                            strokeWidth="8"
                            strokeDasharray={circumference}
                            strokeDashoffset={dashOffset}
                            strokeLinecap="butt"
                        />
                    </svg>

                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <div className="flex items-end">
                            <span className="text-[48px] font-bold leading-none text-[#3b82f6]">{scoreData.score}</span>
                            <span className={`mb-1 text-[26px] font-bold leading-none ${isDarkMode ? 'text-zinc-300' : 'text-slate-600'}`}>/100</span>
                        </div>
                        <span className={`mt-1 text-[20px] ${isDarkMode ? 'text-zinc-300' : 'text-slate-700'}`}>{scoreData.label}</span>
                    </div>
                </div>

                <p className={`mx-auto mt-2 max-w-[420px] text-[18px] leading-10 ${isDarkMode ? 'text-zinc-400' : 'text-slate-600'}`}>
                    {scoreData.message}
                </p>
            </div>
        </div>
    );
};
