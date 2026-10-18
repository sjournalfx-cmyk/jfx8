import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Trade, UserProfile, EASession, CashTransaction } from '../types';
import {
    Info, Activity,
    Target, LineChart, Shield, X, Printer, Zap, LayoutDashboard, LayoutGrid, Coins, AlertTriangle, Lightbulb, CircleCheck, RotateCcw, HelpCircle, Gauge, MoreHorizontal
} from 'lucide-react';
import { Tooltip } from './ui/Tooltip';
import { normalizePlan } from '../lib/constants';


import { PLByMindsetWidget } from './analytics/PLByMindsetWidget';

import { PerformanceBySession } from './analytics/PerformanceBySession';
import { ReportView } from './analytics/ReportView';
import { CurrencyStrengthMeter } from './analytics/CurrencyStrengthMeter';
import { PairDistributionTreemapWidget } from './analytics/PairDistributionTreemapWidget';
import { EquityCurveWidget } from './analytics/EquityCurveWidget';
import { MomentumStreakWidget } from './analytics/MomentumStreakWidget';
import { SymbolPerformanceWidget } from './analytics/SymbolPerformanceWidget';
import { DrawdownOverTimeWidget } from './analytics/DrawdownOverTimeWidget';
import { StrategyPerformancePieChart } from './analytics/StrategyPerformancePieChart';
import { TradingMistakesBarChartWidget } from './analytics/TradingMistakesBarChartWidget';
import { RevenueMatrixWidget } from './analytics/RevenueMatrixWidget';
import { ComparisonView } from './analytics/ComparisonView';
import { TradeGradeDistributionWidget } from './analytics/TradeGradeDistributionWidget';
import { PsychologyAnalyzeLoader, PsychologyAnalyzeEmptyState } from './analytics/PsychologyAnalyzeState';
import { TimeAnalysisMatrixWidget } from './analytics/TimeAnalysisMatrixWidget';
import { DetailedStatistics } from './analytics/DetailedStatistics';
import { CashTransactionsView } from './analytics/CashTransactionsView';
import { ComplianceView } from './analytics/compliance/ComplianceView';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { WidgetHelpDrawer } from './ui/WidgetHelpDrawer';
import { resolveBridgeBackedInitialBalance } from '../lib/bridgeBalance';
import { calculateDisciplineScore } from '../lib/disciplineScore';
import { type PsychologyInsightsEntry } from '../lib/psychologyInsights';

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
    // Strip markdown code fences if wrapped in ```markdown ... ```
    const cleanContent = content.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '');
    const lines = cleanContent.split(/\r?\n/).map((line) => line.trim());
    const sections: PsychologyBriefSection[] = [];
    let currentSection: PsychologyBriefSection | null = null;

    const flushSection = () => {
        if (currentSection && currentSection.items.length > 0) {
            sections.push(currentSection);
        }
        currentSection = null;
    };

    const cleanMarkdown = (s: string) => s.replace(/^\*+|\*+$/g, '').replace(/^_+|_+$/g, '').trim();

    for (const rawLine of lines) {
        if (!rawLine) continue;

        const headingMatch = rawLine.match(/^#{1,6}\s*(.+)$/);
        const headingText = (headingMatch?.[1] ?? rawLine).trim();
        const cleanHeading = headingText.replace(/^[*_#\s\d.)]+|[*_#:\s]+$/g, '').toLowerCase();

        const isKeyInsights = /key\s*insight/i.test(cleanHeading);
        const isWarnings = /warning|risk/i.test(cleanHeading);
        const isAction = /action|step/i.test(cleanHeading);

        if (isKeyInsights || isWarnings || isAction) {
            flushSection();
            const sectionTitle = isKeyInsights ? 'Key Insights' : isWarnings ? 'Warnings' : 'Immediate Action';
            const tone: PsychologyBriefTone = isWarnings ? 'warning' : isAction ? 'action' : 'insight';
            currentSection = {
                title: sectionTitle,
                tone,
                items: [],
            };
            continue;
        }

        if (!currentSection) {
            continue;
        }

        const cleanedLine = stripLocalFilePaths(rawLine.replace(/^[-*•\d.)]\s*/, '').trim());
        if (!cleanedLine) continue;
        if (isLocalFilePathText(cleanedLine)) continue;

        let rawTitle = '';
        let rawBody = '';

        // Check for bold title like **Title**: detail or **Title:** detail
        const boldMatch = cleanedLine.match(/^\*\*([^*]+)\*\*[:\s–—-]*(.*)$/);
        if (boldMatch) {
            rawTitle = boldMatch[1].replace(/[:\s–—-]+$/, '').trim();
            rawBody = boldMatch[2].trim();
        } else {
            const separatorIndex = cleanedLine.search(/[:–—-]/);
            if (separatorIndex > 0) {
                rawTitle = cleanedLine.slice(0, separatorIndex).trim();
                rawBody = cleanedLine.slice(separatorIndex + 1).trim();
            } else {
                rawTitle = cleanedLine;
                rawBody = '';
            }
        }

        if (isLocalFilePathText(rawTitle) && !rawBody) continue;
        const title = cleanMarkdown(stripLocalFilePaths(rawTitle));
        const body = cleanMarkdown(stripLocalFilePaths(rawBody));
        if (!title && !body) continue;

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
        shell: 'border-[#19371f] bg-[#000000]',
        stripe: 'bg-emerald-500',
        icon: 'text-emerald-400',
        title: 'text-white',
    },
    warning: {
        shell: 'border-[#4a201f] bg-[#000000]',
        stripe: 'bg-rose-500',
        icon: 'text-rose-400',
        title: 'text-white',
    },
    action: {
        shell: 'border-[#19412b] bg-[#000000]',
        stripe: 'bg-sky-500',
        icon: 'text-sky-400',
        title: 'text-white',
    },
};


const LOCAL_FILE_PATH_PATTERNS = [
    /[A-Za-z]:[\\/][^\s)'"`\]]*/g,
    /file:\/\/[^\s)'"`\]]+/gi,
    /(?:\/tmp\/|\/var\/folders\/|\\Temp\\|AppData[\\/]Local[\\/]Temp[\\/])[^\s)'"`\]]*/gi,
    /pi-clipboard-[A-Za-z0-9-]+\.(png|jpe?g|webp|gif|bmp)/gi,
];

const isLocalFilePathText = (value: string): boolean => {
    const trimmed = value.trim();
    if (!trimmed) return false;
    return (
        /[A-Za-z]:[\\/]/.test(trimmed) ||
        /pi-clipboard-/i.test(trimmed) ||
        /AppData[\\/]Local[\\/]Temp/i.test(trimmed) ||
        /\\Temp\\/i.test(trimmed) ||
        /^file:\/\//i.test(trimmed) ||
        /^[^\s]+\.(png|jpe?g|webp|gif|bmp)$/i.test(trimmed)
    );
};

const stripLocalFilePaths = (value: string): string => {
    if (!value) return '';
    let out = value;
    out = out.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
    for (const pattern of LOCAL_FILE_PATH_PATTERNS) {
        pattern.lastIndex = 0;
        out = out.replace(pattern, '');
    }
    return out.replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
};

const sanitizePsychologyContent = (content: string): string => {
    if (!content) return '';
    const lines = content.split(/\r?\n/);
    const cleanedLines: string[] = [];
    for (let line of lines) {
        line = stripLocalFilePaths(line);
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (/^#{1,6}\s*(.+)$/.test(trimmed)) {
            cleanedLines.push(trimmed);
            continue;
        }
        const bulletMatch = trimmed.match(/^([-*•]\s+)(.*)$/);
        const body = (bulletMatch?.[2] ?? trimmed).trim();
        if (!body || /^[:\-–—\s]*$/.test(body)) continue;
        if (isLocalFilePathText(body)) continue;
        cleanedLines.push(bulletMatch ? `${bulletMatch[1]}${body}` : body);
    }
    return cleanedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
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

// Tabs always visible on phones; everything else collapses behind "More".
const PRIMARY_TAB_IDS = ['overview', 'trades', 'psychology', 'compliance'];

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
            <svg className="h-[150px] w-[150px]" viewBox="0 0 140 140" aria-hidden="true">
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
                    <span className="text-[34px] font-bold text-[#2563eb]">{value}</span>
                    <span className="pb-1 text-[16px] font-semibold text-[#cbd5e1]">/100</span>
                </div>
                <div className="mt-1.5 text-[12px] font-semibold text-[#cbd5e1]">
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
  lastKnownBridgeBalance?: import('../lib/bridgeBalance').StoredBridgeBalance | number | null;
  isBridgeOnline?: boolean;
  cashTransactions?: CashTransaction[];
  dailyPsychologyInsights?: PsychologyInsightsEntry | null;
  onRefreshPsychologyInsights?: () => void;
  isRefreshingPsychologyInsights?: boolean;
  psychologyAnalyzeLimitReached?: boolean;
  isDemoMode?: boolean;
  activeTabOverride?: 'overview' | 'trades' | 'psychology' | 'advanced' | 'comparison' | 'cash' | 'reports' | 'session' | 'compliance';
  hideTopChrome?: boolean;
}

const Analytics: React.FC<AnalyticsProps> = ({ isDarkMode, trades: rawTrades = [], userProfile, eaSession, lastKnownBridgeBalance, isBridgeOnline = false, cashTransactions = [], dailyPsychologyInsights = null, onRefreshPsychologyInsights, isRefreshingPsychologyInsights = false, psychologyAnalyzeLimitReached = false, isDemoMode = false, onViewChange, activeTabOverride, hideTopChrome = false }) => {
    const trades = useMemo(() => {
        return sortTradesChronologically(rawTrades);
    }, [rawTrades]);

    const completedTrades = useMemo(() => getCompletedTrades(trades), [trades]);

    const [activeInfo, setActiveInfo] = useState<{ title: string, content: string } | null>(null);
    const [isReportModalOpen, setIsReportModalOpen] = useState(false);
    const sanitizedPsychologyContent = useMemo(
        () => (dailyPsychologyInsights?.content ? sanitizePsychologyContent(dailyPsychologyInsights.content) : ''),
        [dailyPsychologyInsights]
    );
    const psychologyBriefSections = useMemo(
        () => (sanitizedPsychologyContent ? parsePsychologyBrief(sanitizedPsychologyContent) : []),
        [sanitizedPsychologyContent]
    );
    const [expandedBriefItems, setExpandedBriefItems] = useState<Record<string, boolean>>({});
    const toggleBriefItem = (key: string) => {
        setExpandedBriefItems((prev) => ({ ...prev, [key]: !prev[key] }));
    };
    
    const currencySymbol = userProfile?.currencySymbol || '$';

    const [allWidgetsOrder, setAllWidgetsOrder] = useLocalStorage('analytics_bento_order', [
      'winRate', 'profitFactor', 'grossProfit', 'grossLoss',
      'equityCurve', 'drawdown',
      'streakMomentum', 'symbolPerformance', 'currencyStrength',
      'riskReward', 'tradeGrade', 'psychSlip', 'timeMatrix'
    ]);

    const reportWidgets = useMemo(() => {
        return Array.from(new Set([
            ...allWidgetsOrder,
            'timeAnalysis',
            'perfByPair',
            'strategyPerf',
            'executionTable'
        ]));
    }, [allWidgetsOrder]);

    const stats = useMemo(() => {
        return calculateStats(trades);
    }, [trades]);

    const effectiveInitialBalance = useMemo(() => {
        return resolveBridgeBackedInitialBalance({
            trades: completedTrades,
            userProfile,
            eaSession,
            lastKnownBridgeBalance,
            isBridgeOnline,
            isDemoMode,
        });
    }, [userProfile, eaSession, lastKnownBridgeBalance, isBridgeOnline, completedTrades, isDemoMode]);

    const equityData = useMemo(() => {
        // Merge completed trades and cash transactions by timestamp
        type TimelineEvent = { timestamp: number; delta: number };

        const events: TimelineEvent[] = [
            ...completedTrades.map((t) => {
                const dt = `${t.date}T${t.time || '00:00'}`;
                const parsed = new Date(dt).getTime();
                return {
                    timestamp: Number.isNaN(parsed) ? 0 : parsed,
                    delta: safePnL(t.pnl),
                };
            }),
            ...cashTransactions.map((c) => {
                const parsed = new Date(c.date).getTime();
                const isDeposit = c.type === 'Deposit' || c.type === 'Interest' || c.type === 'Promotion';
                const sign = isDeposit ? 1 : -1;
                return {
                    timestamp: Number.isNaN(parsed) ? 0 : parsed,
                    delta: sign * Math.abs(c.amount || 0),
                };
            }),
        ].sort((a, b) => a.timestamp - b.timestamp);

        let cumulative = effectiveInitialBalance;
        const data = [cumulative];
        events.forEach((e) => {
            cumulative += e.delta;
            data.push(cumulative);
        });
        return data;
    }, [completedTrades, cashTransactions, effectiveInitialBalance]);

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
        return calculateDisciplineScore(completedTrades) ?? 0;
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
                <section className="flex h-[380px] max-h-[380px] min-h-[380px] flex-col overflow-hidden rounded-[20px] border-0 bg-[#0a0a0a] text-white px-6 py-6">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <h2 className="text-[15px] font-semibold tracking-tight text-left text-white">Tilt Score</h2>
                            <Tooltip
                                content="Your discipline score based on plan adherence across all trades. Higher is better."
                                isDarkMode={true}
                                onInfoClick={() => handleOpenHelp('tiltScore')}
                            >
                                <HelpCircle size={14} className="opacity-40 cursor-help hover:opacity-100 text-white" />
                            </Tooltip>
                        </div>
                    </div>

                    <div className="flex flex-1 flex-col items-center justify-center min-h-0 overflow-hidden">
                        <div className="flex flex-col items-center justify-center gap-5">
                            <DonutChart value={disciplineScore} />
                            <p className="max-w-[280px] text-center text-[13px] leading-6 text-[#cbd5e1]">
                                {disciplineScore >= 90
                                    ? 'Your rule-following is strong. Keep protecting that consistency.'
                                    : disciplineScore >= 75
                                        ? 'Your discipline is developing well. Focus on maintaining consistency in your trading approach.'
                                        : disciplineScore >= 60
                                            ? 'Your discipline is improving, but emotional execution is still leaking returns.'
                                            : 'Your discipline is inconsistent. Tighten your process before adding size.'}
                            </p>
                        </div>
                    </div>
                </section>

                <section className="flex h-[380px] max-h-[380px] min-h-[380px] flex-col overflow-hidden rounded-[14px] border-0 bg-[#0a0a0a] text-white p-[18px]">
                    <div className="mb-3 flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                                <h2 className="text-sm sm:text-[15px] font-semibold tracking-tight text-white whitespace-nowrap">Key Insights & Warnings</h2>
                                <Tooltip content="AI-generated breakdown of your cognitive strengths, warning patterns, and suggested improvements based on your trade psychology." isDarkMode={true} onInfoClick={() => handleOpenHelp('psychSlip')}>
                                    <HelpCircle size={13} className="opacity-40 cursor-help hover:opacity-100 text-white shrink-0" />
                                </Tooltip>
                            </div>
                            {dailyPsychologyInsights?.generatedAt && !isRefreshingPsychologyInsights ? (
                                <p className="text-[10px] text-zinc-500 mt-0.5 truncate">
                                    Last sync: {new Date(dailyPsychologyInsights.generatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, {new Date(dailyPsychologyInsights.generatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                                </p>
                            ) : null}
                        </div>
                        {sanitizedPsychologyContent || isRefreshingPsychologyInsights ? (
                            <button
                                type="button"
                                onClick={onRefreshPsychologyInsights}
                                disabled={!onRefreshPsychologyInsights || isRefreshingPsychologyInsights || psychologyAnalyzeLimitReached}
                                aria-label="Analyze psychology insights"
                                title={psychologyAnalyzeLimitReached ? 'Daily Analyze limit reached (3/3)' : 'Analyze psychology insights'}
                                className="group shrink-0 inline-flex items-center justify-center rounded-lg p-1.5 text-zinc-400 hover:text-white hover:bg-white/10 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                <RotateCcw size={13} className={isRefreshingPsychologyInsights ? 'animate-spin text-white' : 'transition-transform duration-200 group-hover:rotate-180'} />
                            </button>
                        ) : null}
                    </div>

                    {sanitizedPsychologyContent ? (
                        psychologyBriefSections.length > 0 ? (
                            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
                                {psychologyBriefSections.flatMap((section, sectionIndex) =>
                                    section.items.map((item, itemIndex) => {
                                        const tone = item.tone;
                                        const toneClasses = psychologyCardToneClasses[tone];
                                        const Icon = tone === 'warning' ? AlertTriangle : tone === 'action' ? CircleCheck : Lightbulb;
                                        const itemKey = `${section.title}-${itemIndex}-${sectionIndex}`;
                                        const isExpanded = !!expandedBriefItems[itemKey];
                                        const isLong = (item.body?.length ?? 0) > 110;

                                        return (
                                            <article
                                                key={itemKey}
                                                className={`relative overflow-hidden rounded-[8px] border px-3 py-2.5 ${toneClasses.shell} shadow-[0_1px_0_rgba(255,255,255,0.03)]`}
                                            >
                                                <div className={`absolute left-0 top-0 h-full w-[4px] ${toneClasses.stripe}`} />
                                                <div className="flex items-start gap-2.5 pl-1">
                                                    <div className={`mt-0.5 shrink-0 ${toneClasses.icon}`}>
                                                        <Icon size={15} strokeWidth={2.35} />
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <h3 className={`truncate text-[13px] font-semibold leading-5 ${toneClasses.title}`} title={item.title}>
                                                            {item.title}
                                                        </h3>
                                                        {item.body ? (
                                                            <>
                                                                <p
                                                                    className={`mt-0.5 break-words text-[12px] leading-5 text-white/75 ${isExpanded ? '' : 'line-clamp-2'}`}
                                                                    title={isExpanded ? undefined : item.body}
                                                                >
                                                                    {item.body}
                                                                </p>
                                                                {isLong ? (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => toggleBriefItem(itemKey)}
                                                                        className="mt-0.5 text-[11px] font-semibold text-sky-400/90 transition-colors hover:text-sky-300"
                                                                    >
                                                                        {isExpanded ? 'Show less' : 'Show more'}
                                                                    </button>
                                                                ) : null}
                                                            </>
                                                        ) : null}
                                                    </div>
                                                </div>
                                            </article>
                                        );
                                    })
                                )}
                            </div>
                        ) : (
                            <div className="min-h-0 flex-1 overflow-hidden rounded-[14px] border border-[#1f1f1f] bg-[#000000] px-5 py-4">
                                <pre className="h-full overflow-y-auto whitespace-pre-wrap break-words text-[13px] leading-6 text-white/85 custom-scrollbar">
                                    {sanitizedPsychologyContent}
                                </pre>
                            </div>
                        )
                    ) : isRefreshingPsychologyInsights ? (
                        <PsychologyAnalyzeLoader />
                    ) : (
                        <PsychologyAnalyzeEmptyState
                            onAnalyze={onRefreshPsychologyInsights}
                            isRefreshing={isRefreshingPsychologyInsights}
                            disabled={!onRefreshPsychologyInsights || psychologyAnalyzeLimitReached}
                            limitReached={psychologyAnalyzeLimitReached}
                        />
                    )}
                </section>
            </div>

            <div className="grid grid-cols-1 gap-6 pb-6">
                <PLByMindsetWidget trades={completedTrades} isDarkMode={isDarkMode} currencySymbol={currencySymbol} onInfoClick={() => handleOpenHelp('plMindset')} />
            </div>
        </div>
    );

    const renderWidget = (id: string) => {
        switch (id) {
            case 'winRate': return (
                <div className="h-full p-6 rounded-[24px] border-0 flex flex-col justify-between bg-[#0a0a0a] text-white">
                    <span className="text-[10px] font-bold uppercase tracking-widest opacity-40 flex items-center justify-between w-full">
                        <span>Win Rate</span>
                        <Tooltip content="The percentage of closed trades that resulted in a profit." isDarkMode={isDarkMode} onInfoClick={() => handleOpenHelp('winRate')}><HelpCircle size={12} className="cursor-help hover:opacity-100 text-[#FF4F00]" /></Tooltip>
                    </span>
                    <div className="text-2xl font-black">{Number(stats.winRate).toFixed(1)}%</div>
                </div>
            );
            case 'profitFactor': return (
                <div className="h-full p-6 rounded-[24px] border-0 flex flex-col justify-between bg-[#0a0a0a] text-white">
                    <span className="text-[10px] font-bold uppercase tracking-widest opacity-40 flex items-center justify-between w-full">
                        <span>Profit Factor</span>
                        <Tooltip content="Gross Profit divided by Gross Loss. A value above 1.0 means the system is profitable." isDarkMode={isDarkMode} onInfoClick={() => handleOpenHelp('profitFactor')}><HelpCircle size={12} className="cursor-help hover:opacity-100 text-[#FF4F00]" /></Tooltip>
                    </span>
                    <div className="text-2xl font-black">{Number(stats.profitFactor).toFixed(1)}</div>
                </div>
            );
            case 'grossProfit': return (
                <div className="h-full p-6 rounded-[24px] border-0 flex flex-col justify-between bg-[#0a0a0a] text-white">
                    <span className="text-[10px] font-bold uppercase tracking-widest opacity-40 flex items-center justify-between w-full">
                        <span>Gross Profit</span>
                        <Tooltip content="Total profit summed from all winning closed trades." isDarkMode={isDarkMode} onInfoClick={() => handleOpenHelp('grossProfit')}><HelpCircle size={12} className="cursor-help hover:opacity-100 text-[#FF4F00]" /></Tooltip>
                    </span>
                    <div className="text-2xl font-black text-emerald-500">+{currencySymbol}{stats.grossProfit.toLocaleString()}</div>
                </div>
            );
            case 'grossLoss': return (
                <div className="h-full p-6 rounded-[24px] border-0 flex flex-col justify-between bg-[#0a0a0a] text-white">
                    <span className="text-[10px] font-bold uppercase tracking-widest opacity-40 flex items-center justify-between w-full">
                        <span>Gross Loss</span>
                        <Tooltip content="Total loss summed from all losing closed trades." isDarkMode={isDarkMode} onInfoClick={() => handleOpenHelp('grossLoss')}><HelpCircle size={12} className="cursor-help hover:opacity-100 text-[#FF4F00]" /></Tooltip>
                    </span>
                    <div className="text-2xl font-black text-rose-500">-{currencySymbol}{stats.grossLoss.toLocaleString()}</div>
                </div>
            );
            case 'equityCurve': return <EquityCurveWidget trades={completedTrades} equityData={equityData} isDarkMode={isDarkMode} currencySymbol={currencySymbol} hideCurrentValue={normalizePlan(userProfile?.plan) !== 'FREE' && completedTrades.length === 0} onInfoClick={() => handleOpenHelp('equityCurve')} />;
            case 'drawdown': return <DrawdownOverTimeWidget trades={completedTrades} isDarkMode={isDarkMode} userProfile={userProfile} startingBalance={effectiveInitialBalance} onInfoClick={() => handleOpenHelp('drawdown')} onCta={() => onViewChange('log-trade')} />;
            case 'currencyStrength': return <CurrencyStrengthMeter isDarkMode={isDarkMode} trades={completedTrades} onInfoClick={() => handleOpenHelp('currencyStrength')} />;
            case 'tradeGrade': return <TradeGradeDistributionWidget trades={completedTrades} isDarkMode={isDarkMode} onInfoClick={() => handleOpenHelp('tradeGrade')} />;
            default: return null;
        }
    };

    const [activeTab, setActiveTab] = useState<'overview' | 'trades' | 'psychology' | 'advanced' | 'comparison' | 'cash' | 'reports' | 'session' | 'compliance'>(activeTabOverride ?? 'overview');
    // Sync when Home top bar drives the tab externally (e.g. Overview/Trades/… at Home level)
    useEffect(() => {
        if (activeTabOverride && activeTabOverride !== activeTab) {
            setActiveTab(activeTabOverride);
        }
    }, [activeTabOverride]);
    // Tab content swaps inside a persistent scroll container (mobile <main>
    // plus this view's own inner scroller) — reset both to top so a new
    // tab never opens mid-page from the previous tab's scroll position.
    const analyticsRootRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        analyticsRootRef.current?.scrollTo({ top: 0, behavior: 'auto' });
        analyticsRootRef.current?.closest('main')?.scrollTo({ top: 0, behavior: 'auto' });
    }, [activeTab]);
    const [isHelpDrawerOpen, setIsHelpDrawerOpen] = useState(false);
    const [helpWidgetId, setHelpWidgetId] = useState<string | null>(null);
    const [isMoreOpen, setIsMoreOpen] = useState(false);

    const handleOpenHelp = (id: string) => {
        setHelpWidgetId(id);
        setIsHelpDrawerOpen(true);
    };

    const tabDefinitions = [
        { id: 'overview', label: 'Overview', icon: LayoutDashboard },
        { id: 'advanced', label: 'Advanced', icon: Gauge },
        { id: 'trades', label: 'Trade Analysis', icon: LineChart },
        { id: 'psychology', label: 'Psychology', icon: Target },
        { id: 'compliance', label: 'Rules Compliance', icon: Shield },
        { id: 'session', label: 'Session', icon: Zap },
        { id: 'comparison', label: 'Reports', icon: Activity },
        { id: 'reports', label: 'Comparison', icon: Shield },
        { id: 'cash', label: 'Transactions', icon: Coins }
    ];

    const secondaryTabs = tabDefinitions.filter(tab => !PRIMARY_TAB_IDS.includes(tab.id));
    const activeSecondaryTab = secondaryTabs.find(tab => tab.id === activeTab);

    const renderOverviewLayout = () => (
        <div className="space-y-6 pb-20">
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                {['winRate', 'profitFactor', 'grossProfit', 'grossLoss'].map((id) => (
                    <div key={id} className="min-h-[90px]">
                        {renderWidget(id)}
                    </div>
                ))}
                <div className="min-h-[90px]">
                    <div className="h-full p-5 rounded-[20px] border-0 flex flex-col justify-between bg-[#0a0a0a] text-white">
                        <span className="text-[9px] font-bold uppercase tracking-widest opacity-40 flex items-center justify-between w-full">
                            <span>Total P&L</span>
                            <Tooltip content="Net realized profit or loss from all closed trades." isDarkMode={isDarkMode} onInfoClick={() => handleOpenHelp('netProfit')}><HelpCircle size={10} className="cursor-help hover:opacity-100 text-[#FF4F00]" /></Tooltip>
                        </span>
                        <div className="text-xl font-black text-emerald-500">{currencySymbol}{stats.netProfit.toLocaleString()}</div>
                    </div>
                </div>
                <div className="min-h-[90px]">
                    <div className="h-full p-5 rounded-[20px] border-0 flex flex-col justify-between bg-[#0a0a0a] text-white">
                        <span className="text-[9px] font-bold uppercase tracking-widest opacity-40 flex items-center justify-between w-full">
                            <span>Risk/Reward</span>
                            <Tooltip content="Average winning trade amount divided by average losing trade amount." isDarkMode={isDarkMode} onInfoClick={() => handleOpenHelp('riskReward')}><HelpCircle size={10} className="cursor-help hover:opacity-100 text-[#FF4F00]" /></Tooltip>
                        </span>
                        <div className="text-xl font-black">{stats.avgWin > 0 && stats.avgLoss < 0 ? (Math.abs(stats.avgWin) / Math.abs(stats.avgLoss)).toFixed(2) : '0.00'}</div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6">
                <div className="min-h-[120px]">
                    <MomentumStreakWidget trades={completedTrades} isDarkMode={isDarkMode} onInfoClick={() => handleOpenHelp('momentumStreak')} />
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
            : 'bg-[#000000] text-zinc-200';

    return (
        <div ref={analyticsRootRef} className={`w-full h-full overflow-y-auto custom-scrollbar p-4 sm:p-6 lg:p-10 pb-nav font-sans ${pageBackgroundClass}`}>
            {!hideTopChrome && (
            <header className="mb-4 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="flex items-center gap-2 mb-2">
                            <h1 className={`text-3xl font-black tracking-tight ${pageIsLight ? 'text-slate-950' : 'text-zinc-100'}`}>Performance Analytics</h1>
                            {isDemoMode && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest border border-amber-500/30 bg-amber-500/10 text-amber-300">
                                    Demo Mode
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </header>
            )}
            {!hideTopChrome && (
            <nav
                role="tablist"
                aria-label="Analytics sections"
                className={`sticky top-0 z-20 -mx-4 sm:-mx-6 lg:-mx-10 px-4 sm:px-6 lg:px-10 py-2 flex overflow-x-auto no-scrollbar snap-x snap-mandatory gap-2 border-b backdrop-blur-xl overscroll-x-contain touch-pan-x scroll-smooth ${pageIsLight ? 'bg-white/90 border-slate-200' : 'bg-black/80 border-zinc-800'}`}
            >
                {tabDefinitions.map(tab => {
                    const isPrimary = PRIMARY_TAB_IDS.includes(tab.id);
                    const isActive = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            role="tab"
                            aria-selected={isActive}
                            onClick={() => setActiveTab(tab.id as any)}
                            className={`${isPrimary ? 'flex' : 'hidden sm:flex'} shrink-0 snap-center justify-center px-4 py-2.5 rounded-lg text-xs font-bold uppercase tracking-widest whitespace-nowrap items-center gap-2 min-h-[44px] ${isActive
                                ? (pageIsLight ? 'bg-white text-black shadow-sm' : 'bg-[#FF4F00] text-white shadow-lg')
                                : (pageIsLight ? 'text-slate-500 hover:text-slate-700' : 'text-zinc-500 hover:text-zinc-300')}`}
                        >
                            <tab.icon size={14} />
                            {tab.label}
                        </button>
                    );
                })}
                <button
                    key="more"
                    role="tab"
                    aria-selected={!!activeSecondaryTab}
                    aria-haspopup="true"
                    aria-expanded={isMoreOpen}
                    onClick={() => setIsMoreOpen(true)}
                    className={`sm:hidden shrink-0 snap-center justify-center px-4 py-2.5 rounded-lg text-xs font-bold uppercase tracking-widest whitespace-nowrap flex items-center gap-2 min-h-[44px] ${activeSecondaryTab
                        ? (pageIsLight ? 'bg-white text-black shadow-sm' : 'bg-[#FF4F00] text-white shadow-lg')
                        : (pageIsLight ? 'text-slate-500 hover:text-slate-700' : 'text-zinc-500 hover:text-zinc-300')}`}
                >
                    {activeSecondaryTab ? <activeSecondaryTab.icon size={14} /> : <MoreHorizontal size={14} />}
                    {activeSecondaryTab ? activeSecondaryTab.label : 'More'}
                </button>
            </nav>
            )}

            {activeTab === 'overview' && renderOverviewLayout()}
            
            {activeTab === 'trades' && (
                <div className="space-y-6 pb-20">
                    <div className="grid grid-cols-1 gap-4">
                        <SymbolPerformanceWidget trades={completedTrades} isDarkMode={isDarkMode} currencySymbol={currencySymbol} onInfoClick={() => handleOpenHelp('symbolPerformance')} />
                    </div>
                    <div className="grid grid-cols-1 gap-4">
                        <StrategyPerformancePieChart trades={completedTrades} isDarkMode={isDarkMode} currencySymbol={currencySymbol} onInfoClick={() => handleOpenHelp('strategyPerformance')} onCta={() => onViewChange('log-trade')} />
                    </div>
                    <div className="grid grid-cols-1 gap-4">
                        <PairDistributionTreemapWidget trades={completedTrades} isDarkMode={isDarkMode} currencySymbol={currencySymbol} onInfoClick={() => handleOpenHelp('pairDistribution')} onCta={() => onViewChange('log-trade')} />
                    </div>
                </div>
            )}

            {activeTab === 'advanced' && (
                <div className="space-y-6 pb-20">
                    <div className="grid grid-cols-1 gap-4">
                        <TradingMistakesBarChartWidget trades={completedTrades} isDarkMode={isDarkMode} onInfoClick={() => handleOpenHelp('tradingMistakes')} />
                    </div>
                    <div className="w-full min-h-[320px]">
                        <RevenueMatrixWidget trades={completedTrades} isDarkMode={isDarkMode} currencySymbol={currencySymbol} onInfoClick={() => handleOpenHelp('revenueMatrix')} onCta={() => onViewChange('log-trade')} />
                    </div>
                </div>
            )}

            {activeTab === 'psychology' && renderPsychologyLayout()}

            {activeTab === 'compliance' && (
                <ComplianceView
                    trades={completedTrades}
                    isDarkMode={isDarkMode}
                    currencySymbol={currencySymbol}
                    userProfile={userProfile}
                    onInfoClick={(id) => handleOpenHelp(id)}
                    onCta={() => onViewChange('history')}
                />
            )}

            {activeTab === 'comparison' && (
                <div className="space-y-8 pb-20 [zoom:0.88] origin-top">
                    <div className="flex justify-between items-center gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                            <h2 className="text-sm sm:text-base font-bold whitespace-nowrap truncate">Detailed Performance Report</h2>
                            <Tooltip content="A comprehensive breakdown of all key performance metrics, trading days, and drawdowns." isDarkMode={isDarkMode} onInfoClick={() => handleOpenHelp('detailedReport')}>
                                <HelpCircle size={16} className="opacity-40 cursor-help hover:opacity-100" />
                            </Tooltip>
                        </div>
                        <button
                            disabled
                            aria-disabled="true"
                            onClick={(e) => e.preventDefault()}
                            className={`px-4 sm:px-6 py-3 rounded-xl font-bold flex items-center gap-2 shrink-0 cursor-not-allowed opacity-50 ${isDarkMode ? 'bg-black text-white' : 'bg-black text-white'}`}
                        >
                            <Printer size={18} />
                            <span className="hidden min-[420px]:inline">Generate PDF Report</span>
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

            {activeTab === 'reports' && <ComparisonView trades={completedTrades} isDarkMode={isDarkMode} currencySymbol={currencySymbol} onInfoClick={() => handleOpenHelp('comparison')} />}

            {activeTab === 'cash' && (
                <CashTransactionsView
                    isDarkMode={isDarkMode}
                    userProfile={userProfile}
                    cashTransactions={cashTransactions}
                    onCashTransactionsInfoClick={() => handleOpenHelp('cashTransactions')}
                    onTransactionMomentumInfoClick={() => handleOpenHelp('transactionMomentum')}
                />
            )}

            {activeTab === 'session' && (
                <div className="space-y-12 pb-20">
                    <PerformanceBySession
                        trades={completedTrades}
                        isDarkMode={isDarkMode}
                        currencySymbol={currencySymbol}
                        onMarketSessionsInfoClick={() => handleOpenHelp('marketSessions')}
                        onHourlyPerformanceInfoClick={() => handleOpenHelp('hourlyPerformance')}
                        onDailyActivityInfoClick={() => handleOpenHelp('dailyActivity')}
                    />

                    <TimeAnalysisMatrixWidget
                        trades={completedTrades}
                        isDarkMode={isDarkMode}
                        currencySymbol={currencySymbol}
                        onInfoClick={() => handleOpenHelp('timeAnalysis')}
                    />
                </div>
            )}

            {/* Mobile "More" sheet — the secondary analytics tabs hidden from the
                phone tab strip. Desktop renders all tabs inline, so this stays
                sm:hidden to avoid duplicating them. */}
            {isMoreOpen && (
                <div className="sm:hidden">
                    <div
                        className="fixed inset-0 z-[140] bg-black/60 backdrop-blur-sm"
                        onClick={() => setIsMoreOpen(false)}
                        aria-hidden="true"
                    />
                    <div className="fixed bottom-0 left-0 right-0 z-[141] rounded-t-2xl border-t border-white/10 bg-[#0a0a0a] p-4 pb-[calc(16px+env(safe-area-inset-bottom))]">
                        <div className="mb-3 flex items-center justify-between">
                            <h3 className="text-sm font-bold text-white">More analytics</h3>
                            <button
                                type="button"
                                onClick={() => setIsMoreOpen(false)}
                                aria-label="Close more analytics"
                                className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-400 hover:text-white active:scale-95 transition-all touch-manipulation"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            {secondaryTabs.map(tab => (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => {
                                        setActiveTab(tab.id as any);
                                        setIsMoreOpen(false);
                                    }}
                                    aria-current={activeTab === tab.id ? 'page' : undefined}
                                    className={`min-h-[44px] flex items-center gap-2 rounded-xl border px-3 text-xs font-bold uppercase tracking-widest transition-all ${activeTab === tab.id
                                        ? 'border-[#FF4F00] bg-[#FF4F00] text-white'
                                        : 'border-white/10 bg-white/[0.04] text-zinc-300 hover:text-white'}`}
                                >
                                    <tab.icon size={16} />
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Widget Details Help Drawer - rendered once at root so it appears above all content */}
            <WidgetHelpDrawer
                isOpen={isHelpDrawerOpen}
                widgetId={helpWidgetId}
                onClose={() => setIsHelpDrawerOpen(false)}
                isDarkMode={isDarkMode}
            />
        </div>
    );
};

export default Analytics;
