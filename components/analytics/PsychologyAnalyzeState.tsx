import React, { useEffect, useState } from 'react';
import { Activity, AlertTriangle, BookOpen, Brain, CircleCheck, Lightbulb, RotateCcw, ShieldCheck, Sparkles } from 'lucide-react';

const PHASES = [
    { icon: BookOpen, text: 'Reading your journal entries' },
    { icon: Activity, text: 'Scanning emotional patterns' },
    { icon: Brain, text: 'Detecting cognitive biases' },
    { icon: ShieldCheck, text: 'Reviewing discipline & risk habits' },
    { icon: Sparkles, text: 'Composing personalized insights' },
];

const KeyframesStyle = () => (
    <style>{`
        @keyframes psyFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
        @keyframes psyShimmer { 0% { transform: translateX(-120%); } 100% { transform: translateX(420%); } }
        @keyframes psyFadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes psyRing { 0% { transform: scale(0.9); opacity: 0.65; } 100% { transform: scale(1.55); opacity: 0; } }
    `}</style>
);

export const PsychologyAnalyzeLoader: React.FC = () => {
    const [phaseIndex, setPhaseIndex] = useState(0);

    useEffect(() => {
        const timer = window.setInterval(() => {
            setPhaseIndex((prev) => (prev + 1) % PHASES.length);
        }, 1900);
        return () => window.clearInterval(timer);
    }, []);

    const PhaseIcon = PHASES[phaseIndex].icon;

    return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-4">
            <KeyframesStyle />

            <div className="relative flex h-[84px] w-[84px] items-center justify-center">
                <span className="absolute inset-0 rounded-full border border-[#93c5fd]/40" style={{ animation: 'psyRing 2.6s ease-out infinite' }} />
                <span className="absolute inset-0 rounded-full border border-[#a78bfa]/35" style={{ animation: 'psyRing 2.6s ease-out infinite', animationDelay: '1.3s' }} />
                <div className="absolute inset-[14px] flex items-center justify-center rounded-full border border-white/[0.07] bg-gradient-to-br from-[#93c5fd]/10 via-transparent to-[#a78bfa]/10">
                    <PhaseIcon key={phaseIndex} size={28} strokeWidth={1.8} className="text-[#93c5fd]" style={{ animation: 'psyFadeUp 500ms ease both' }} />
                </div>
            </div>

            <div className="flex flex-col items-center gap-1 text-center">
                <h3 className="text-[15px] font-semibold text-white">Analyzing your trading psychology…</h3>
                <p key={phaseIndex} style={{ animation: 'psyFadeUp 450ms ease both' }} className="text-[13px] text-[#93c5fd]">
                    {PHASES[phaseIndex].text}…
                </p>
            </div>

            <div className="relative h-[3px] w-56 overflow-hidden rounded-full bg-[#000000]">
                <span className="absolute top-0 h-full w-1/4 rounded-full bg-gradient-to-r from-transparent via-[#93c5fd] to-transparent" style={{ animation: 'psyShimmer 1.6s linear infinite' }} />
            </div>
        </div>
    );
};

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
    <div className="flex flex-1 flex-col items-center justify-center gap-6 rounded-[14px] border border-dashed border-[#1f1f1f] bg-[#000000] px-6 py-10 text-center">
        <KeyframesStyle />

        <div className="relative h-24 w-28">
            <div className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-2xl border border-white/[0.08] bg-[#000000] shadow-[0_8px_24px_rgba(0,0,0,0.5)]">
                <Sparkles size={22} className="text-[#93c5fd]" />
            </div>
            <div className="absolute -left-2 top-1 flex h-8 w-8 items-center justify-center rounded-xl border border-white/[0.06] bg-[#000000]" style={{ animation: 'psyFloat 3s ease-in-out infinite' }}>
                <Lightbulb size={14} className="text-[#fbbf24]" />
            </div>
            <div className="absolute -right-2 top-4 flex h-8 w-8 items-center justify-center rounded-xl border border-white/[0.06] bg-[#000000]" style={{ animation: 'psyFloat 3s ease-in-out infinite', animationDelay: '0.8s' }}>
                <AlertTriangle size={14} className="text-[#fb7185]" />
            </div>
            <div className="absolute bottom-0 left-1/2 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-xl border border-white/[0.06] bg-[#000000]" style={{ animation: 'psyFloat 3s ease-in-out infinite', animationDelay: '1.6s' }}>
                <CircleCheck size={14} className="text-[#7ae2b1]" />
            </div>
        </div>

        <div className="flex w-full flex-col items-center">
            <h3 className="text-[15px] font-semibold text-white">Unlock today&apos;s psychology report</h3>
            <div className="mt-5 flex w-full items-center justify-center">
                <button
                    type="button"
                    onClick={onAnalyze}
                    disabled={!onAnalyze || isRefreshing || disabled}
                    title={limitReached ? 'Daily Analyze limit reached (3/3)' : 'Analyze psychology insights'}
                    className="inline-flex items-center justify-center gap-2 rounded-full border border-[#93c5fd]/30 bg-[#93c5fd]/10 px-6 py-2.5 text-[13px] font-semibold text-white transition-all hover:bg-[#93c5fd]/20 hover:border-[#93c5fd]/50 disabled:cursor-not-allowed disabled:opacity-45"
                >
                    <RotateCcw size={14} className={isRefreshing ? 'animate-spin' : 'text-[#93c5fd]'} />
                    {isRefreshing ? 'Analyzing…' : limitReached ? 'Limit reached' : 'Analyze'}
                </button>
            </div>
            {limitReached ? (
                <p className="mt-2 text-[11px] text-[#52525b]">Daily Analyze limit reached (3/3). Try again tomorrow.</p>
            ) : null}
        </div>
    </div>
);
