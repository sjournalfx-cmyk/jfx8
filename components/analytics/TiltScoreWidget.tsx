import React, { useMemo } from 'react';
import { HelpCircle } from 'lucide-react';
import { Trade } from '../../types';
import { calculateDisciplineScore, getDisciplineScoreLabel } from '../../lib/disciplineScore';
import { Tooltip } from '../ui/Tooltip';

interface TiltScoreWidgetProps {
    trades: Trade[];
    isDarkMode: boolean;
    onInfoClick?: () => void;
}

export const TiltScoreWidget: React.FC<TiltScoreWidgetProps> = ({ trades = [], isDarkMode, onInfoClick }) => {
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

    // Same 270° arc gauge as the psychology-tab tilt card (150px svg).
    const radius = 55;
    const circumference = 2 * Math.PI * radius;
    const arcRatio = 0.75;
    const arcLength = circumference * arcRatio;
    const gapLength = circumference - arcLength;
    const progressLength = (scoreData.score / 100) * arcLength;
    const progressGap = circumference - progressLength;

    return (
        <div className={`flex min-h-[380px] flex-col rounded-[20px] border-0 px-7 py-7 ${isDarkMode ? 'bg-[#0a0a0a] text-white' : 'bg-white text-slate-950 shadow-sm'}`}>
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <h2 className="text-left text-[15px] font-semibold tracking-tight">Tilt Score</h2>
                    <Tooltip
                        content="Your discipline score based on plan adherence across all trades. Higher is better."
                        isDarkMode={true}
                        onInfoClick={onInfoClick}
                    >
                        <HelpCircle size={14} className="cursor-help opacity-40 hover:opacity-100" />
                    </Tooltip>
                </div>
            </div>

            <div className="flex flex-1 flex-col items-center justify-center gap-6 pt-2">
                <div className="relative flex w-full justify-center">
                    <svg className="h-[150px] w-[150px]" viewBox="0 0 140 140" aria-hidden="true">
                        <circle
                            cx="70"
                            cy="70"
                            r={radius}
                            stroke={isDarkMode ? '#171717' : '#eef0f3'}
                            strokeWidth="16"
                            fill="transparent"
                            strokeDasharray={`${arcLength} ${gapLength}`}
                            strokeLinecap="butt"
                            transform="rotate(135 70 70)"
                        />
                        <circle
                            cx="70"
                            cy="70"
                            r={radius}
                            stroke="#2563eb"
                            strokeWidth="16"
                            fill="transparent"
                            strokeDasharray={`${progressLength} ${progressGap}`}
                            strokeLinecap="butt"
                            transform="rotate(135 70 70)"
                        />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <div className="flex items-end justify-center gap-1 leading-none">
                            <span className="text-[34px] font-bold text-[#2563eb]">{scoreData.score}</span>
                            <span className={`pb-1 text-[16px] font-semibold ${isDarkMode ? 'text-[#cbd5e1]' : 'text-slate-500'}`}>/100</span>
                        </div>
                        <div className={`mt-1.5 text-[12px] font-semibold ${isDarkMode ? 'text-[#cbd5e1]' : 'text-slate-500'}`}>
                            {scoreData.label}
                        </div>
                    </div>
                </div>

                <p className={`max-w-[280px] text-center text-[14px] leading-7 ${isDarkMode ? 'text-[#cbd5e1]' : 'text-slate-600'}`}>
                    {scoreData.message}
                </p>
            </div>
        </div>
    );
};
