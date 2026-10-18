import React, { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface PhasedLoaderPhase {
    icon: LucideIcon;
    text: string;
}

interface PhasedLoaderProps {
    /** Ordered phases cycled through while the work runs. */
    phases: PhasedLoaderPhase[];
    /** Optional heading shown above the cycling phase text. */
    title?: string;
    /** Milliseconds each phase stays on screen. Defaults to 1900. */
    intervalMs?: number;
    /** Light-mode variant for forms rendered on a white background. */
    isDarkMode?: boolean;
    /** Accent color for the ring, icon, text and shimmer. */
    accentColor?: string;
    className?: string;
}

const KeyframesStyle = () => (
    <style>{`
        @keyframes jfxPhaseFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
        @keyframes jfxPhaseShimmer { 0% { transform: translateX(-120%); } 100% { transform: translateX(420%); } }
        @keyframes jfxPhaseFadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes jfxPhaseRing { 0% { transform: scale(0.9); opacity: 0.65; } 100% { transform: scale(1.55); opacity: 0; } }
    `}</style>
);

/**
 * Cycled, multi-phase progress indicator used to make longer operations feel
 * active. Extracted from the psychology analyze loader so importing, syncing
 * and refreshing flows can share the same "labor illusion" treatment.
 */
export const PhasedLoader: React.FC<PhasedLoaderProps> = ({
    phases,
    title,
    intervalMs = 1900,
    isDarkMode = true,
    accentColor = '#93c5fd',
    className = '',
}) => {
    const [phaseIndex, setPhaseIndex] = useState(0);
    const count = phases.length;

    useEffect(() => {
        if (count <= 1) return;
        const timer = window.setInterval(() => {
            setPhaseIndex((prev) => (prev + 1) % count);
        }, intervalMs);
        return () => window.clearInterval(timer);
    }, [count, intervalMs]);

    if (count === 0) return null;

    const activeIndex = phaseIndex % count;
    const PhaseIcon = phases[activeIndex].icon;

    return (
        <div className={`flex flex-1 flex-col items-center justify-center gap-4 px-6 py-4 ${className}`}>
            <KeyframesStyle />

            <div className="relative flex h-[84px] w-[84px] items-center justify-center">
                <span
                    className="absolute inset-0 rounded-full border"
                    style={{ borderColor: accentColor, opacity: 0.4, animation: 'jfxPhaseRing 2.6s ease-out infinite' }}
                />
                <span
                    className="absolute inset-0 rounded-full border"
                    style={{ borderColor: accentColor, opacity: 0.35, animation: 'jfxPhaseRing 2.6s ease-out infinite', animationDelay: '1.3s' }}
                />
                <div className={`absolute inset-[14px] flex items-center justify-center rounded-full border ${isDarkMode ? 'border-white/[0.07] bg-white/[0.03]' : 'border-slate-200 bg-slate-50'}`}>
                    <PhaseIcon
                        key={activeIndex}
                        size={28}
                        strokeWidth={1.8}
                        style={{ color: accentColor, animation: 'jfxPhaseFadeUp 500ms ease both' }}
                    />
                </div>
            </div>

            <div className="flex flex-col items-center gap-1 text-center">
                {title ? (
                    <h3 className={`text-[15px] font-semibold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{title}</h3>
                ) : null}
                <p
                    key={activeIndex}
                    style={{ color: accentColor, animation: 'jfxPhaseFadeUp 450ms ease both' }}
                    className="text-[13px]"
                >
                    {phases[activeIndex].text}…
                </p>
            </div>

            <div className={`relative h-[3px] w-56 overflow-hidden rounded-full ${isDarkMode ? 'bg-[#141414]' : 'bg-slate-200'}`}>
                <span
                    className="absolute top-0 h-full w-1/4 rounded-full"
                    style={{ backgroundImage: `linear-gradient(90deg, transparent, ${accentColor}, transparent)`, animation: 'jfxPhaseShimmer 1.6s linear infinite' }}
                />
            </div>
        </div>
    );
};
