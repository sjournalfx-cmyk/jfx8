import React from 'react';
import { Activity, BookOpen, Brain, ShieldCheck, Sparkles } from 'lucide-react';
import { EmptyState } from '../ui/Skeleton';
import { PhasedLoader, type PhasedLoaderPhase } from '../ui/PhasedLoader';

const PHASES: PhasedLoaderPhase[] = [
    { icon: BookOpen, text: 'Reading your journal entries' },
    { icon: Activity, text: 'Scanning emotional patterns' },
    { icon: Brain, text: 'Detecting cognitive biases' },
    { icon: ShieldCheck, text: 'Reviewing discipline & risk habits' },
    { icon: Sparkles, text: 'Composing personalized insights' },
];

export const PsychologyAnalyzeLoader: React.FC = () => (
    <PhasedLoader
        phases={PHASES}
        title="Analyzing your trading psychology"
        intervalMs={1900}
    />
);

type PsychologyAnalyzeEmptyStateProps = {
    onAnalyze?: () => void;
    isRefreshing?: boolean;
    disabled?: boolean;
    limitReached?: boolean;
};

export const PsychologyAnalyzeEmptyState: React.FC<PsychologyAnalyzeEmptyStateProps> = ({
    onAnalyze,
    isRefreshing = false,
    disabled = false,
    limitReached = false,
}) => (
    <div className="flex flex-1 flex-col items-center justify-center rounded-[14px] border border-dashed border-[#1f1f1f] bg-[#080808] px-6 text-center">
        <EmptyState
            isDarkMode={true}
            type="analytics"
            icon={<Sparkles size={40} strokeWidth={1.4} className="text-[#93c5fd]" />}
            title="Unlock today's psychology report"
            description={
                isRefreshing
                    ? 'Analyzing your live journal data…'
                    : limitReached
                        ? 'Daily Analyze limit reached (3/3). Try again tomorrow.'
                        : 'Generate real insights from your live journal data — emotional patterns, cognitive biases, and discipline habits.'
            }
            action={
                onAnalyze && !disabled && !limitReached && !isRefreshing
                    ? { label: 'Analyze now', onClick: onAnalyze }
                    : undefined
            }
        />
    </div>
);
