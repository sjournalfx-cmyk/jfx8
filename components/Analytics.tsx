import React, { useMemo, useState, useEffect } from 'react';
import { Trade, UserProfile, EASession, CashTransaction } from '../types';
import {
    TrendingUp, Info, Activity,
    Target, LineChart, Shield, X, Printer, Gauge, Zap, TrendingDown, LayoutDashboard, LayoutGrid, Coins, AlertTriangle, Lightbulb, CircleCheck, RotateCcw
} from 'lucide-react';

import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    ResponsiveContainer,
    Cell,
    RadarChart,
    PolarGrid,
    PolarAngleAxis,
    PolarRadiusAxis,
    Radar
} from 'recharts';

import { PLByMindsetWidget } from './analytics/PLByMindsetWidget';

import { PerformanceBySession } from './analytics/PerformanceBySession';
import { ReportView } from './analytics/ReportView';
import { PerformanceByPairWidget } from './analytics/PerformanceByPairWidget';
import { CurrencyStrengthMeter } from './analytics/CurrencyStrengthMeter';
import { PairDistributionTreemapWidget } from './analytics/PairDistributionTreemapWidget';
import { EquityCurveWidget } from './analytics/EquityCurveWidget';
import { LargestWinLossWidget } from './analytics/LargestWinLossWidget';
import { MomentumStreakWidget } from './analytics/MomentumStreakWidget';
import { SymbolPerformanceWidget } from './analytics/SymbolPerformanceWidget';
import { DrawdownOverTimeWidget } from './analytics/DrawdownOverTimeWidget';
import { StrategyPerformancePieChart } from './analytics/StrategyPerformancePieChart';
import { TradingMistakesBarChartWidget } from './analytics/TradingMistakesBarChartWidget';
import { OutcomeDistributionWidget } from './analytics/OutcomeDistributionWidget';
import { RobustnessLab } from './analytics/RobustnessLab';
import { PerformanceMatrixWidget } from './analytics/PerformanceMatrixWidget';
import { ComparisonView } from './analytics/ComparisonView';
import { TradeGradeDistributionWidget } from './analytics/TradeGradeDistributionWidget';
import { PsychologicalSlipWidget } from './analytics/PsychologicalSlipWidget';
import { TimeAnalysisMatrixWidget } from './analytics/TimeAnalysisMatrixWidget';
import { DetailedStatistics } from './analytics/DetailedStatistics';
import { PLByPlanAdherenceWidget } from './analytics/PLByPlanAdherenceWidget';
import { CashTransactionsView } from './analytics/CashTransactionsView';
import { APP_CONSTANTS, normalizePlan } from '../lib/constants';
import { type PsychologyInsightsEntry } from '../lib/psychologyInsights';

import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    rectSortingStrategy,
} from '@dnd-kit/sortable';
import { SortableWidget } from './ui/SortableWidget';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { calculateStats } from '../lib/statsUtils';
import { getCompletedTrades, sortTradesChronologically } from '../lib/analyticsUtils';

type PsychologyBriefTone = 'insight' | 'warning' | 'action';

type PsychologyBriefItem = {
    title: string;
    body: string;
    tone: PsychologyBriefTone;
};

type PsychologyBriefSection = {
    title: string;
    tone: PsychologyBriefTone;
    items: PsychologyBriefItem[];
};

const parsePsychologyBrief = (content: string): PsychologyBriefSection[] => {
    const lines = content.split(/\r?\n/).map((line) => line.trim());
    const sections: PsychologyBriefSection[] = [];
    let currentSection: PsychologyBriefSection | null = null;

    const flushSection = () => {
        if (currentSection && currentSection.items.length > 0) {
            sections.push(currentSection);
        }
        currentSection = null;
    };

    const getTone = (label: string): PsychologyBriefTone => {
        if (/warning|risk/i.test(label)) return 'warning';
        if (/action/i.test(label)) return 'action';
        return 'insight';
    };

    for (const rawLine of lines) {
        if (!rawLine) continue;

        const headingMatch = rawLine.match(/^#{1,6}\s*(.+)$/);
        const heading = (headingMatch?.[1] ?? rawLine).trim();
        const normalizedHeading = heading.toLowerCase();

        if (normalizedHeading === 'key insights' || normalizedHeading === 'warnings' || normalizedHeading === 'immediate action') {
            flushSection();
            currentSection = {
                title: heading,
                tone: getTone(heading),
                items: [],
            };
            continue;
        }

        if (!currentSection) {
            continue;
        }

        const cleanedLine = rawLine.replace(/^[-*•]\s+/, '').trim();
        if (!cleanedLine) continue;

        const colonIndex = cleanedLine.indexOf(':');
        const title = colonIndex > 0 ? cleanedLine.slice(0, colonIndex).trim() : cleanedLine;
        const body = colonIndex > 0 ? cleanedLine.slice(colonIndex + 1).trim() : '';

        currentSection.items.push({
            title,
            body,
            tone: currentSection.tone,
        });
    }

    flushSection();
    return sections;
};

const psychologyCardToneClasses: Record<PsychologyBriefTone, { shell: string; stripe: string; icon: string; title: string }> = {
    insight: {
        shell: 'border-[#19371f] bg-[#0e1711]',
        stripe: 'bg-emerald-500',
        icon: 'text-emerald-400',
        title: 'text-white',
    },
    warning: {
        shell: 'border-[#4a201f] bg-[#170e0f]',
        stripe: 'bg-rose-500',
        icon: 'text-rose-400',
        title: 'text-white',
    },
    action: {
        shell: 'border-[#19412b] bg-[#0d1612]',
        stripe: 'bg-sky-500',
        icon: 'text-sky-400',
        title: 'text-white',
    },
};

const renderRadarAngleTick = ({ x, y, payload }: any) => {
    const label = payload?.value;
    const offsets: Record<string, { dx: number; dy: number }> = {
        Confident: { dx: 0, dy: -30 },
        Neutral: { dx: 28, dy: 0 },
        Hesitant: { dx: 12, dy: 24 },
        Anxious: { dx: -12, dy: 24 },
        FOMO: { dx: -28, dy: 0 },
    };
    const { dx = 0, dy = 0 } = offsets[label] || {};
    return (
        <text
            x={x + dx}
            y={y + dy}
            fill="#64748b"
            fontSize={13}
            textAnchor="middle"
            dominantBaseline="middle"
        >
            {label}
        </text>
    );
};

const safePnL = (value: unknown): number => {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : 0;
};

type BarChartPoint = {
    label: string;
    value: number;
};

const MINDSETS = ['Confident', 'Neutral', 'Hesitant', 'Anxious', 'FOMO'];

function DonutChart({ value }: { value: number }) {
    const radius = 55;
    const circumference = 2 * Math.PI * radius;
    const arcRatio = 0.75; 
    const arcLength = circumference * arcRatio;
    const gapLength = circumference - arcLength;

    const progressLength = (value / 100) * arcLength;
    const progressGap = circumference - progressLength;

    return (
        <div className="relative flex w-full justify-center">
            <svg className="h-[220px] w-[220px]" viewBox="0 0 140 140" aria-hidden="true">
                <circle
                    cx="70"
                    cy="70"
                    r={radius}
                    stroke="#171717"
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
                    <span className="text-[46px] font-bold text-[#2563eb]">{value}</span>
                    <span className="pb-1 text-[20px] font-semibold text-[#cbd5e1]">/100</span>
                </div>
                <div className="mt-2 text-[13px] font-semibold text-[#cbd5e1]">
                    {value >= 90 ? 'Excellent' : value >= 75 ? 'Good' : value >= 60 ? 'Developing' : 'Needs Work'}
                </div>
            </div>
        </div>
);
};

interface AnalyticsProps {
  isDarkMode: boolean;
  trades: Trade[];
  userProfile: UserProfile;
  onViewChange: (view: string) => void;
  eaSession?: EASession | null;
  cashTransactions?: CashTransaction[];
  dailyPsychologyInsights?: PsychologyInsightsEntry | null;
  onRefreshPsychologyInsights?: () => void;
  isRefreshingPsychologyInsights?: boolean;
}

const Analytics: React.FC<AnalyticsProps> = ({ isDarkMode, trades: rawTrades = [], userProfile, eaSession, cashTransactions = [], dailyPsychologyInsights = null, onRefreshPsychologyInsights, isRefreshingPsychologyInsights = false }) => {
    const trades = useMemo(() => {
        return sortTradesChronologically(rawTrades);
    }, [rawTrades]);

    const completedTrades = useMemo(() => getCompletedTrades(trades), [trades]);

    const [activeInfo, setActiveInfo] = useState<{ title: string, content: string } | null>(null);
    const [isReportModalOpen, setIsReportModalOpen] = useState(false);
    const psychologyBriefSections = useMemo(
        () => (dailyPsychologyInsights?.content ? parsePsychologyBrief(dailyPsychologyInsights.content) : []),
        [dailyPsychologyInsights]
    );
    const [scoreToggled, setScoreToggled] = useState(false);
    
    const currencySymbol = userProfile?.currencySymbol || '$';

    const [allWidgetsOrder, setAllWidgetsOrder] = useLocalStorage('analytics_bento_order', [
      'winRate', 'profitFactor', 'grossProfit', 'grossLoss',
      'equityCurve', 'drawdown',
      'streakMomentum', 'symbolPerformance', 'largestWinLoss', 'currencyStrength', 'matrix', 'tradeExit',
      'outcomeDist', 'tiltScore', 'riskReward', 'plMindset', 'plAdherence', 'tradeGrade', 'psychSlip', 'timeMatrix'
    ]);

    const reportWidgets = useMemo(() => {
        return Array.from(new Set([
            ...allWidgetsOrder,
            'timeAnalysis',
            'performanceMatrix',
            'perfByPair',
            'strategyPerf',
            'executionTable'
        ]));
    }, [allWidgetsOrder]);

    const stats = useMemo(() => {
        return calculateStats(trades);
    }, [trades]);

    const effectiveInitialBalance = useMemo(() => {
        const currentPlan = normalizePlan(userProfile.plan);
        const isPro = currentPlan === APP_CONSTANTS.PLANS.HOBBY;
        const isPremium = currentPlan === APP_CONSTANTS.PLANS.STANDARD;
        if ((isPro || isPremium) && eaSession?.data?.account?.balance !== undefined) {
             const totalPnL = completedTrades.reduce((acc, t) => acc + safePnL(t.pnl), 0);
             return eaSession.data.account.balance - totalPnL;
        }
        return userProfile?.initialBalance || 0;
    }, [userProfile, eaSession, completedTrades]);

    const equityData = useMemo(() => {
        const safeTrades = completedTrades;
        let cumulative = effectiveInitialBalance;
        const data = [cumulative];
        safeTrades.forEach(t => {
            cumulative += safePnL(t.pnl);
            data.push(cumulative);
        });
        return data;
    }, [completedTrades, effectiveInitialBalance]);

    const psychologySummary = useMemo(() => {
        const planBuckets: Record<'Followed Exactly' | 'Minor Deviation' | 'Major Deviation' | 'No Plan', { wins: number; total: number; pnl: number }> = {
            'Followed Exactly': { wins: 0, total: 0, pnl: 0 },
            'Minor Deviation': { wins: 0, total: 0, pnl: 0 },
            'Major Deviation': { wins: 0, total: 0, pnl: 0 },
            'No Plan': { wins: 0, total: 0, pnl: 0 },
        };

        const mindsetBuckets: Record<string, { total: number; pnl: number }> = {};
        completedTrades.forEach((trade) => {
            const adherence = trade.planAdherence || 'No Plan';
            const pnl = safePnL(trade.pnl);
            planBuckets[adherence].total += 1;
            planBuckets[adherence].pnl += pnl;
            if (pnl > 0) {
                planBuckets[adherence].wins += 1;
            }

            const mindset = trade.mindset || 'Neutral';
            if (!mindsetBuckets[mindset]) {
                mindsetBuckets[mindset] = { total: 0, pnl: 0 };
            }
            mindsetBuckets[mindset].total += 1;
            mindsetBuckets[mindset].pnl += pnl;
        });

        const followed = planBuckets['Followed Exactly'];
        const major = planBuckets['Major Deviation'];
        const revengePnl = major.total > 0 ? Math.abs(major.pnl / major.total) : 0;
        const followedWinRate = followed.total > 0 ? (followed.wins / followed.total) * 100 : 0;
        const allOtherBuckets = ['Minor Deviation', 'Major Deviation', 'No Plan'] as const;
        const offPlanTrades = allOtherBuckets.reduce((sum, key) => sum + planBuckets[key].total, 0);
        const offPlanWins = allOtherBuckets.reduce((sum, key) => sum + planBuckets[key].wins, 0);
        const offPlanWinRate = offPlanTrades > 0 ? (offPlanWins / offPlanTrades) * 100 : 0;
        const adherenceLift = followed.total > 0 ? followedWinRate - offPlanWinRate : 0;

        const confidentAvg = mindsetBuckets.Confident?.total ? mindsetBuckets.Confident.pnl / mindsetBuckets.Confident.total : 0;
        const fomoAvg = mindsetBuckets.FOMO?.total ? mindsetBuckets.FOMO.pnl / mindsetBuckets.FOMO.total : 0;
        const fomoCost = mindsetBuckets.FOMO?.total ? confidentAvg - fomoAvg : 0;

        return {
            revengePnl: Math.round(revengePnl * 100) / 100,
            adherenceLift: Math.round(adherenceLift * 100) / 100,
            fomoCost: Math.round(fomoCost * 1000) / 1000,
        };
    }, [completedTrades]);

    const disciplineScore = useMemo(() => {
        if (!completedTrades.length) return 78;

        const score = completedTrades.reduce((total, trade) => {
            switch (trade.planAdherence) {
                case 'Followed Exactly':
                    return total + 100;
                case 'Minor Deviation':
                    return total + 78;
                case 'Major Deviation':
                    return total + 30;
                case 'No Plan':
                    return total + 10;
                default:
                    return total + 55;
            }
        }, 0) / completedTrades.length;

        return Math.round(score);
    }, [completedTrades]);

    const mindsetChartPoints = useMemo<BarChartPoint[]>(() => {
        const labels = MINDSETS;
        return labels.map((label) => ({
            label,
            value: Math.round(
                completedTrades
                    .filter((trade) => (trade.mindset || 'Neutral') === label)
                    .reduce((sum, trade) => sum + safePnL(trade.pnl), 0) * 100
            ) / 100,
        }));
    }, [completedTrades]);

    const radarData = useMemo(() => {
        const avgPnLByMindset = MINDSETS.map((mindset) => {
            const tradesWithMindset = completedTrades.filter((trade) => (trade.mindset || 'Neutral') === mindset);
            const totalPnL = tradesWithMindset.reduce((sum, trade) => sum + safePnL(trade.pnl), 0);
            const count = tradesWithMindset.length;
            return count > 0 ? totalPnL / count : 0;
        });

        const max = Math.max(...avgPnLByMindset.map(Math.abs), 1);
        const normalized = avgPnLByMindset.map((v) => Math.round((v / max) * 40));

        const colors = ['#7ae2b1', '#c0c5cc', '#c0c5cc', '#c0c5cc', '#c0c5cc'];

        return MINDSETS.map((name, i) => ({
            name,
            pl: normalized[i],
            fill: colors[i],
        }));
    }, [completedTrades]);

    const planAdherenceChartPoints = useMemo<BarChartPoint[]>(() => {
        const buckets = [
            { label: 'Followed Plan', key: 'Followed Exactly' },
            { label: 'Minor Deviation', key: 'Minor Deviation' },
            { label: 'Major Deviation', key: 'Major Deviation' },
            { label: 'No Plan', key: 'No Plan' },
        ] as const;

        return buckets.map((bucket) => ({
            label: bucket.label,
            value: Math.round(
                completedTrades
                    .filter((trade) => (trade.planAdherence || 'No Plan') === bucket.key)
                    .reduce((sum, trade) => sum + safePnL(trade.pnl), 0) * 100
            ) / 100,
        }));
    }, [completedTrades]);

const renderPsychologyLayout = () => (
        <div className="space-y-6 pb-20">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,2.05fr)]">
                <section className="flex min-h-[380px] flex-col rounded-[20px] border border-[#1f1f1f] bg-[#000000] px-7 py-7 shadow-[0_1px_2px_rgba(0,0,0,0.35)]">
                    <div className="flex items-center justify-between">
                        <h2 className="text-[18px] font-bold text-white">{scoreToggled ? 'Performance Radar' : 'Tilt Score'}</h2>
                        <div
                            className="inline-flex rounded-full border border-[#2a2a2a] bg-[#0a0a0a] p-1 shadow-[0_1px_0_rgba(255,255,255,0.03)]"
                            role="tablist"
                            aria-label="Tilt score display mode"
                        >
                            <button
                                type="button"
                                onClick={() => setScoreToggled(false)}
                                aria-pressed={!scoreToggled}
                                className={`rounded-full px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] transition-all ${
                                    !scoreToggled
                                        ? 'bg-white text-black shadow-sm'
                                        : 'text-[#94a3b8] hover:text-white'
                                }`}
                            >
                                Score
                            </button>
                            <button
                                type="button"
                                onClick={() => setScoreToggled(true)}
                                aria-pressed={scoreToggled}
                                className={`rounded-full px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] transition-all ${
                                    scoreToggled
                                        ? 'bg-white text-black shadow-sm'
                                        : 'text-[#94a3b8] hover:text-white'
                                }`}
                            >
                                Radar
                            </button>
                        </div>
                    </div>

                    <div className="flex flex-1 flex-col items-center justify-center gap-6 pt-2">
                        {scoreToggled ? (
                            <div className="mx-auto flex h-[320px] w-[320px] items-center justify-center">
                                <ResponsiveContainer width="100%" height="100%">
                                    <RadarChart cx="50%" cy="50%" outerRadius="74%" data={radarData} margin={{ top: 28, right: 28, bottom: 28, left: 28 }}>
                                        <PolarGrid stroke="#e2e8f0" />
                                        <PolarAngleAxis dataKey="name" tick={renderRadarAngleTick} />
                                        <PolarRadiusAxis
                                            angle={90}
                                            domain={[-20, 40]}
                                            tick={false}
                                            axisLine={false}
                                        />
                                        <Radar
                                            name="Performance"
                                            dataKey="pl"
                                            stroke="#4f46e5"
                                            strokeWidth={2}
                                            fill="#4f46e5"
                                            fillOpacity={0.15}
                                            isAnimationActive={false}
                                        />
                                    </RadarChart>
                                </ResponsiveContainer>
                            </div>
                        ) : (
                            <>
                                <DonutChart value={disciplineScore} />
                                <p className="max-w-[280px] text-center text-[14px] leading-7 text-[#cbd5e1]">
                                    {disciplineScore >= 90
                                        ? 'Your rule-following is strong. Keep protecting that consistency.'
                                        : disciplineScore >= 75
                                            ? 'Your discipline is developing well. Focus on maintaining consistency in your trading approach.'
                                            : disciplineScore >= 60
                                                ? 'Your discipline is improving, but emotional execution is still leaking returns.'
                                                : 'Your discipline is inconsistent. Tighten your process before adding size.'}
                                </p>
                            </>
                        )}
                    </div>
                </section>

                <section className="flex min-h-[220px] flex-col rounded-[14px] border border-[#1f1f1f] bg-[#000000] p-4.5 shadow-[0_1px_2px_rgba(0,0,0,0.35)]">
                    <div className="mb-3.5 flex items-start justify-between gap-4">
                        <h2 className="text-[18px] font-bold text-white">Key Insights & Warnings</h2>
                        <button
                            type="button"
                            onClick={onRefreshPsychologyInsights}
                            disabled={!onRefreshPsychologyInsights || isRefreshingPsychologyInsights}
                            className="group inline-flex items-center gap-2 rounded-full border border-[#2c2c2c] bg-[linear-gradient(180deg,#121212_0%,#090909_100%)] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-[#e2e8f0] shadow-[0_1px_0_rgba(255,255,255,0.04),0_8px_18px_rgba(0,0,0,0.25)] transition-all duration-200 hover:border-[#3a3a3a] hover:bg-[linear-gradient(180deg,#161616_0%,#0b0b0b_100%)] hover:text-white hover:shadow-[0_1px_0_rgba(255,255,255,0.06),0_12px_22px_rgba(0,0,0,0.32)] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-[#2c2c2c] disabled:hover:bg-[linear-gradient(180deg,#121212_0%,#090909_100%)]"
                        >
                            <RotateCcw size={12} className={isRefreshingPsychologyInsights ? 'animate-spin text-white' : 'text-[#93c5fd] transition-transform duration-200 group-hover:rotate-12'} />
                            <span className="translate-y-[0.5px]">Analyze</span>
                        </button>
                    </div>

                    {dailyPsychologyInsights?.content ? (
                        psychologyBriefSections.length > 0 ? (
                            <div className="flex-1 space-y-2 overflow-y-auto pr-1">
                                {psychologyBriefSections.flatMap((section, sectionIndex) =>
                                    section.items.map((item, itemIndex) => {
                                        const tone = item.tone;
                                        const toneClasses = psychologyCardToneClasses[tone];
                                        const Icon = tone === 'warning' ? AlertTriangle : tone === 'action' ? CircleCheck : Lightbulb;

                                        return (
                                            <article
                                                key={`${section.title}-${itemIndex}-${sectionIndex}`}
                                                className={`relative overflow-hidden rounded-[8px] border px-4 py-3.5 ${toneClasses.shell} shadow-[0_1px_0_rgba(255,255,255,0.03)]`}
                                            >
                                                <div className={`absolute left-0 top-0 h-full w-[4px] ${toneClasses.stripe}`} />
                                                <div className="flex items-start gap-2.5 pl-1">
                                                    <div className={`mt-0.5 shrink-0 ${toneClasses.icon}`}>
                                                        <Icon size={16} strokeWidth={2.35} />
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <h3 className={`text-[14px] font-semibold leading-5 ${toneClasses.title}`}>
                                                            {item.title}
                                                        </h3>
                                                        {item.body ? (
                                                            <p className="mt-1 text-[12px] leading-5 text-white/82">
                                                                {item.body}
                                                            </p>
                                                        ) : null}
                                                    </div>
                                                </div>
                                            </article>
                                        );
                                    })
                                )}
                            </div>
                        ) : (
                            <div className="rounded-[14px] border border-[#1f1f1f] bg-[#080808] px-5 py-5">
                                <pre className="whitespace-pre-wrap text-[15px] leading-7 text-white">
                                    {dailyPsychologyInsights.content}
                                </pre>
                            </div>
                        )
                    ) : (
                        <div className="flex flex-1 items-center justify-center rounded-[14px] border border-dashed border-[#1f1f1f] bg-[#080808] px-6 text-center">
                            <p className="max-w-sm text-[13px] leading-5 text-white">
                                Click <span className="font-semibold text-white">Analyze</span> to generate today&apos;s real psychology insights from your live journal data.
                            </p>
                        </div>
                    )}
                </section>
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-6">
                {/* P/L by Mindset */}
                <PLByMindsetWidget trades={completedTrades} isDarkMode={isDarkMode} currencySymbol={currencySymbol} />

                {/* P/L by Plan Adherence */}
                <PLByPlanAdherenceWidget trades={completedTrades} isDarkMode={isDarkMode} currencySymbol={currencySymbol} />
            </div>
        </div>
    );

    const renderWidget = (id: string) => {
        switch (id) {
            case 'winRate': return <div className={`h-full p-6 rounded-[24px] border flex flex-col justify-between ${isDarkMode ? 'bg-[#18181b] border-zinc-800' : 'bg-white border-slate-200 shadow-md'}`}><span className="text-[10px] font-bold uppercase tracking-widest opacity-40 flex items-center gap-2"><Target size={14} className="text-indigo-500" /> Win Rate</span><div className="text-2xl font-black">{Number(stats.winRate).toFixed(1)}%</div></div>;
            case 'profitFactor': return <div className={`h-full p-6 rounded-[24px] border flex flex-col justify-between ${isDarkMode ? 'bg-[#18181b] border-zinc-800' : 'bg-white border-slate-200 shadow-md'}`}><span className="text-[10px] font-bold uppercase tracking-widest opacity-40 flex items-center gap-2"><Gauge size={14} className="text-indigo-500" /> Profit Factor</span><div className="text-2xl font-black">{Number(stats.profitFactor).toFixed(1)}</div></div>;
            case 'grossProfit': return <div className={`h-full p-6 rounded-[24px] border flex flex-col justify-between ${isDarkMode ? 'bg-[#18181b] border-zinc-800' : 'bg-white border-slate-200 shadow-md'}`}><span className="text-[10px] font-bold uppercase tracking-widest opacity-40 flex items-center gap-2"><TrendingUp size={14} className="text-emerald-500" /> Gross Profit</span><div className="text-2xl font-black text-emerald-500">+{currencySymbol}{stats.grossProfit.toLocaleString()}</div></div>;
            case 'grossLoss': return <div className={`h-full p-6 rounded-[24px] border flex flex-col justify-between ${isDarkMode ? 'bg-[#18181b] border-zinc-800' : 'bg-white border-slate-200 shadow-md'}`}><span className="text-[10px] font-bold uppercase tracking-widest opacity-40 flex items-center gap-2"><TrendingDown size={14} className="text-rose-500" /> Gross Loss</span><div className="text-2xl font-black text-rose-500">-{currencySymbol}{stats.grossLoss.toLocaleString()}</div></div>;
            case 'equityCurve': return <EquityCurveWidget trades={completedTrades} equityData={equityData} isDarkMode={isDarkMode} currencySymbol={currencySymbol} />;
            case 'drawdown': return <DrawdownOverTimeWidget trades={completedTrades} isDarkMode={isDarkMode} userProfile={userProfile} startingBalance={effectiveInitialBalance} />;
            case 'streakMomentum': return <MomentumStreakWidget trades={completedTrades} isDarkMode={isDarkMode} />;
            case 'symbolPerformance': return <SymbolPerformanceWidget trades={completedTrades} isDarkMode={isDarkMode} currencySymbol={currencySymbol} />;
            case 'largestWinLoss': return <LargestWinLossWidget trades={completedTrades} isDarkMode={isDarkMode} currencySymbol={currencySymbol} />;
            case 'currencyStrength': return <CurrencyStrengthMeter isDarkMode={isDarkMode} trades={completedTrades} />;
            case 'outcomeDist': return <OutcomeDistributionWidget trades={completedTrades} isDarkMode={isDarkMode} />;
            case 'tiltScore': return null;
            case 'riskReward': return <div className={`h-full p-8 rounded-[32px] border ${isDarkMode ? 'bg-[#18181b] border-zinc-800' : 'bg-white border-slate-200 shadow-md'}`}><h3 className="font-bold text-lg mb-6 flex items-center gap-2"><Activity size={20} className="text-indigo-500" /> Risk/Reward</h3><div className="space-y-6"><div className="flex justify-between items-end"><span className="text-sm opacity-60">Avg Win</span><span className="text-xl font-black text-emerald-500">{currencySymbol}{Math.round(stats.avgWin).toLocaleString()}</span></div><div className="flex justify-between items-end"><span className="text-sm opacity-60">Avg Loss</span><span className="text-xl font-black text-rose-500">{currencySymbol}{Math.round(stats.avgLoss).toLocaleString()}</span></div></div></div>;
            case 'plMindset': return null;
            case 'plAdherence': return null;
            case 'matrix': return <PerformanceMatrixWidget trades={completedTrades} isDarkMode={isDarkMode} currencySymbol={currencySymbol} />;
            case 'tradeGrade': return <TradeGradeDistributionWidget trades={completedTrades} isDarkMode={isDarkMode} />;
            case 'psychSlip': return <PsychologicalSlipWidget trades={completedTrades} isDarkMode={isDarkMode} currencySymbol={currencySymbol} />;
            case 'timeMatrix': return <TimeAnalysisMatrixWidget trades={completedTrades} isDarkMode={isDarkMode} currencySymbol={currencySymbol} />;
            default: return null;
        }
    };

    const getColSpan = (id: string) => {
        switch (id) {
            case 'equityCurve': return 'col-span-12 lg:col-span-8';
            case 'drawdown': return 'col-span-12 lg:col-span-4';
            case 'winRate': case 'profitFactor': case 'grossProfit': case 'grossLoss': return 'col-span-12 sm:col-span-6 lg:col-span-3';
            case 'riskReward': case 'tradeGrade': return 'col-span-12 md:col-span-6 lg:col-span-4';
            case 'matrix': case 'psychSlip': case 'timeMatrix': return 'col-span-12';
            default: return 'col-span-12 md:col-span-6 lg:col-span-4';
        }
    };

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!active || !over || active.id === over.id) return;
        setAllWidgetsOrder((items) => {
            const oldIndex = items.indexOf(String(active.id));
            const newIndex = items.indexOf(String(over.id));
            return arrayMove(items, oldIndex, newIndex);
        });
    };

    const [activeTab, setActiveTab] = useState<'overview' | 'trades' | 'psychology' | 'advanced' | 'comparison' | 'cash' | 'reports' | 'session'>('overview');

    const tabDefinitions = [
        { id: 'overview', label: 'Overview', icon: LayoutDashboard },
        { id: 'trades', label: 'Trade Analysis', icon: LineChart },
        { id: 'psychology', label: 'Psychology', icon: Target },
        { id: 'session', label: 'Session', icon: Zap },
        { id: 'advanced', label: 'Advanced', icon: Gauge },
        { id: 'comparison', label: 'Reports', icon: Activity },
        { id: 'reports', label: 'Comparison', icon: Shield },
        { id: 'cash', label: 'Transactions', icon: Coins }
    ];

    const widgetCategories = {
        overview: ['winRate', 'profitFactor', 'grossProfit', 'grossLoss', 'equityCurve', 'drawdown', 'currencyStrength', 'riskReward', 'tradeGrade'],
        trades: ['symbolPerformance', 'largestWinLoss', 'outcomeDist'],
        psychology: ['psychSlip', 'streakMomentum', 'tiltScore', 'plMindset', 'plAdherence'],
        advanced: []
    };

    const renderCategoryWidgets = (category: string) => {
        const widgetIds = widgetCategories[category as keyof typeof widgetCategories] || [];
        return (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={widgetIds} strategy={rectSortingStrategy}>
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-6 pb-20 auto-rows-min">
                        {widgetIds.map(id => (
                            <SortableWidget key={id} id={id} className={getColSpan(id)}>
                                {renderWidget(id)}
                            </SortableWidget>
                        ))}
                    </div>
                </SortableContext>
            </DndContext>
        );
    };

    const renderOverviewLayout = () => (
        <div className="space-y-6 pb-20">
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                {['winRate', 'profitFactor', 'grossProfit', 'grossLoss'].map((id) => (
                    <div key={id} className="min-h-[90px]">
                        {renderWidget(id)}
                    </div>
                ))}
                <div className="min-h-[90px]">
                    <div className={`h-full p-5 rounded-[20px] border flex flex-col justify-between ${isDarkMode ? 'bg-[#18181b] border-zinc-800' : 'bg-white border-slate-200 shadow-md'}`}>
                        <span className="text-[9px] font-bold uppercase tracking-widest opacity-40 flex items-center gap-1.5"><TrendingUp size={12} className="text-emerald-500" /> Total P&L</span>
                        <div className="text-xl font-black text-emerald-500">{currencySymbol}{stats.netProfit.toLocaleString()}</div>
                    </div>
                </div>
                <div className="min-h-[90px]">
                    <div className={`h-full p-5 rounded-[20px] border flex flex-col justify-between ${isDarkMode ? 'bg-[#18181b] border-zinc-800' : 'bg-white border-slate-200 shadow-md'}`}>
                        <span className="text-[9px] font-bold uppercase tracking-widest opacity-40 flex items-center gap-1.5"><Activity size={12} className="text-indigo-500" /> Risk/Reward</span>
                        <div className="text-xl font-black">{stats.avgWin > 0 && stats.avgLoss < 0 ? (Math.abs(stats.avgWin) / Math.abs(stats.avgLoss)).toFixed(2) : '0.00'}</div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6">
                <div className="min-h-[120px]">
                    <MomentumStreakWidget trades={completedTrades} isDarkMode={isDarkMode} />
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
                <div className="xl:col-span-3 min-h-[340px]">
                    {renderWidget('equityCurve')}
                </div>
                <div className="xl:col-span-2 min-h-[340px]">
                    {renderWidget('drawdown')}
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <div className="min-h-[220px]">
                    {renderWidget('currencyStrength')}
                </div>
                <div className="min-h-[220px]">
                    {renderWidget('tradeGrade')}
                </div>
            </div>
        </div>
    );

    const pageIsLight = !isDarkMode && activeTab !== 'psychology';
    const pageBackgroundClass = activeTab === 'psychology'
        ? 'bg-[#000000] text-zinc-200'
        : pageIsLight
            ? 'bg-[#F8FAFC] text-slate-900'
            : 'bg-[#050505] text-zinc-200';

    return (
        <div className={`w-full h-full overflow-y-auto custom-scrollbar p-6 lg:p-10 font-sans ${pageBackgroundClass}`}>
            <header className="mb-8 flex flex-col gap-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className={`text-3xl font-black tracking-tight mb-2 ${pageIsLight ? 'text-slate-950' : 'text-zinc-100'}`}>Performance Analytics</h1>
                    </div>
                </div>
                <div className={`grid grid-cols-2 gap-1.5 p-1.5 rounded-xl border sm:grid-cols-4 md:grid-cols-8 ${pageIsLight ? 'bg-slate-100 border-slate-200' : 'bg-[#111] border-zinc-800'}`}>
                    {tabDefinitions.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as any)}
                            className={`w-full justify-center px-3 py-2.5 rounded-lg text-xs font-bold uppercase tracking-widest whitespace-nowrap flex items-center gap-2 ${activeTab === tab.id 
                                ? (pageIsLight ? 'bg-white text-black shadow-sm' : 'bg-zinc-800 text-white shadow-lg') 
                                : (pageIsLight ? 'text-slate-500 hover:text-slate-700' : 'text-zinc-500 hover:text-zinc-300')}`}
                        >
                            <tab.icon size={14} />
                            {tab.label}
                        </button>
                    ))}
                </div>
            </header>

            {activeTab === 'overview' && renderOverviewLayout()}
            
            {activeTab === 'trades' && (
                <div className="space-y-6 pb-20">
                    <div className="grid grid-cols-1 gap-4">
                        <SymbolPerformanceWidget trades={completedTrades} isDarkMode={isDarkMode} currencySymbol={currencySymbol} />
                    </div>
                    <div className="grid grid-cols-1 gap-4">
                        <PairDistributionTreemapWidget trades={completedTrades} isDarkMode={isDarkMode} currencySymbol={currencySymbol} />
                    </div>
                </div>
            )}

            {activeTab === 'psychology' && renderPsychologyLayout()}

            {activeTab === 'advanced' && (
                <div className="space-y-6 pb-20">
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                        <div className="min-h-[280px]">
                            <StrategyPerformancePieChart trades={completedTrades} isDarkMode={isDarkMode} currencySymbol={currencySymbol} />
                        </div>
                        <div className="min-h-[280px]">
                            <TradingMistakesBarChartWidget trades={completedTrades} isDarkMode={isDarkMode} />
                        </div>
                    </div>
                    <div className="min-h-[320px]">
                        <PerformanceMatrixWidget trades={completedTrades} isDarkMode={isDarkMode} currencySymbol={currencySymbol} />
                    </div>
                </div>
            )}

            {activeTab === 'comparison' && (
                <div className="space-y-8 pb-20">
                    <div className="flex justify-between items-center">
                        <h2 className="text-xl font-bold">Detailed Performance Report</h2>
                        <button
                            disabled
                            aria-disabled="true"
                            onClick={(e) => e.preventDefault()}
                            className={`px-6 py-3 rounded-xl font-bold flex items-center gap-2 cursor-not-allowed opacity-50 ${isDarkMode ? 'bg-zinc-800 text-white' : 'bg-black text-white'}`}
                        >
                            <Printer size={18} />
                            Generate PDF Report
                        </button>
                    </div>

                    <DetailedStatistics
                        stats={stats}
                        userProfile={userProfile}
                        isDarkMode={isDarkMode}
                    />

                    <div className={isDarkMode ? 'opacity-50' : 'opacity-100'}>
                        <ReportView
                            trades={completedTrades}
                            isDarkMode={isDarkMode}
                            userProfile={userProfile}
                            monthStr={new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}
                            selectedWidgets={reportWidgets}
                            equityData={equityData}
                            stats={stats}
                        />
                    </div>
                </div>
            )}

            {activeTab === 'reports' && <ComparisonView trades={completedTrades} isDarkMode={isDarkMode} currencySymbol={currencySymbol} />}

            {activeTab === 'cash' && (
                <CashTransactionsView
                    isDarkMode={isDarkMode}
                    userProfile={userProfile}
                    cashTransactions={cashTransactions}
                />
            )}

            {activeTab === 'session' && (
                <div className="space-y-12 pb-20">
                    <PerformanceBySession
                        trades={completedTrades}
                        isDarkMode={isDarkMode}
                        currencySymbol={currencySymbol}
                    />

                    <TimeAnalysisMatrixWidget 
                        trades={completedTrades} 
                        isDarkMode={isDarkMode} 
                        currencySymbol={currencySymbol} 
                    />

                    <div className="flex justify-center pt-8 border-t border-zinc-500/10">
                        <p className="text-xs font-bold opacity-30 uppercase tracking-[0.2em] italic">
                            All times are calculated in SAST (Africa/Johannesburg)
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Analytics;
