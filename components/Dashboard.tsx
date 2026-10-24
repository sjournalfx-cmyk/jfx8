import React, { lazy, Suspense, useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { ArrowUpRight, ArrowDownRight, Activity, TrendingUp, DollarSign, BarChart2, Zap, Coins, GripVertical, Cpu, ArrowRight, Lock, Info, X, Gauge, CalendarDays, AlertTriangle, RefreshCw, Plus, Sparkles, Flame, Inbox } from 'lucide-react';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    rectSortingStrategy,
} from '@dnd-kit/sortable';

import { Trade, DailyBias, UserProfile, EASession } from '../types';
import SessionClock from './SessionClock';
import DailyQuote from './DailyQuote';
import { SortableWidget } from './ui/SortableWidget';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useCtraderSymbols } from '../hooks/useCtraderSymbols';
import { dataService } from '../services/dataService';
import { supabase } from '../lib/supabase';
import OpenPositions from './OpenPositions';

// Keep the live-trading stack out of the dashboard's initial bundle.
const CtraderAccountPanel = lazy(() =>
    import('./desktop/CtraderAccountPanel').then((m) => ({ default: m.CtraderAccountPanel }))
);
import { EquityCurveWidget } from './analytics/EquityCurveWidget';
import { Skeleton, EmptyState } from './ui/Skeleton';
import { Tooltip } from './ui/Tooltip';
import { getSASTDateTime } from '../lib/timeUtils';
import { sortTradesChronologically } from '../lib/analyticsUtils';
import { APP_CONSTANTS, normalizePlan } from '../lib/constants';
import { haptic } from '../lib/haptics';
import { fetchEconomicCalendar, getCalendarWindow } from '../lib/economicCalendarClient';

const safePnL = (value: unknown): number => {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : 0;
};

type EconomicCalendarItem = {
    date: string;
    time?: string;
    currency?: string;
    Currency?: string;
    impact?: string;
    Impact?: string;
    event?: string;
    Event?: string;
    actual?: string;
    Actual?: string;
    forecast?: string;
    Forecast?: string;
    previous?: string;
    Previous?: string;
    source?: string;
    datetime_local?: string;
    datetime_utc?: string;
};

interface DashboardProps {
    isDarkMode: boolean;
    trades: Trade[];
    dailyBias: DailyBias[];
    onUpdateBias: (bias: DailyBias) => void;
    userProfile: UserProfile;
    onViewChange: (view: string) => void;
    eaSession?: EASession | null;
    lastKnownBridgeBalance?: import('../lib/bridgeBalance').StoredBridgeBalance | number | null;
    isBridgeOnline?: boolean;
    isLoading?: boolean;
    offlineQueue?: Trade[];
    isDemoMode?: boolean;
    ctraderAccountId?: string | null;
    ctraderPortfolioId?: string | null;
    userTimezone?: string;
}

// --- MOBILE EMPTY STATE (shared EmptyState + CTA to Log) ---
const MobileEmptyState: React.FC<{ isDarkMode: boolean; onCta: () => void; isFreeTier?: boolean }> = ({ isDarkMode, onCta, isFreeTier }) => (
    <div className={`rounded-2xl border border-dashed overflow-hidden ${isDarkMode ? 'bg-[#000000] border-zinc-800' : 'bg-white border-slate-200 shadow-md'}`}>
        <EmptyState
            isDarkMode={isDarkMode}
            type="trades"
            icon={<Inbox size={40} strokeWidth={1.4} className="text-[#FF4F01] opacity-90" />}
            title="No trades yet"
            description="Your journal is empty. Log your first trade to unlock stats, equity curve & streak insights."
            action={{ label: 'Log First Trade', onClick: () => { try { haptic.light(); } catch {} onCta(); } }}
        />
        <div className="flex flex-col items-center gap-2 px-6 pb-6 -mt-2 text-center">
            {isFreeTier && (
                <span className={`text-[11px] font-bold px-3 py-1 rounded-full border ${isDarkMode ? 'border-zinc-800 text-zinc-500 bg-zinc-900/40' : 'border-slate-200 text-slate-500 bg-slate-50'}`}>Free plan · unlimited demo preview</span>
            )}
            <p className={`text-[11px] font-medium ${isDarkMode ? 'text-zinc-600' : 'text-slate-400'}`}>Takes ~20 seconds — you can edit or delete any time.</p>
        </div>
    </div>
);

// --- WIDGET COMPONENTS ---

const DashboardSkeleton = ({ isDarkMode }: { isDarkMode: boolean }) => (
    <div className="space-y-8 animate-in fade-in duration-500">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map(i => (
                <div key={i} className={`h-32 p-6 rounded-2xl border ${isDarkMode ? 'bg-[#000000] border-[#27272a]' : 'bg-white border-slate-100 shadow-md'}`}>
                    <Skeleton className="w-8 h-8 rounded-lg mb-4" />
                    <Skeleton className="w-24 h-6 mb-2" />
                    <Skeleton className="w-16 h-3" />
                </div>
            ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className={`col-span-1 lg:col-span-2 h-[250px] p-6 rounded-2xl border ${isDarkMode ? 'bg-[#000000] border-[#27272a]' : 'bg-white border-slate-100 shadow-md'}`}>
                <Skeleton className="w-32 h-6 mb-6" />
                <Skeleton className="w-full h-32" />
            </div>
            <div className={`col-span-1 h-[250px] p-6 rounded-2xl border ${isDarkMode ? 'bg-[#000000] border-[#27272a]' : 'bg-white border-slate-100 shadow-md'}`}>
                <Skeleton className="w-32 h-6 mb-6" />
                <div className="space-y-3">
                    <Skeleton className="w-full h-10" />
                    <Skeleton className="w-full h-10" />
                    <Skeleton className="w-full h-10" />
                </div>
            </div>
        </div>
    </div>
);

const EASetupPrompt = ({ isDarkMode, onSetupClick }: { isDarkMode: boolean, onSetupClick: () => void }) => (
    <div className={`mb-6 sm:mb-8 p-4 sm:p-8 rounded-2xl sm:rounded-[32px] border-2 border-dashed flex flex-col md:flex-row items-center justify-between gap-4 sm:gap-6 transition-all text-center md:text-left ${isDarkMode ? 'bg-indigo-500/5 border-indigo-500/20' : 'bg-indigo-50 border-indigo-200'}`}>
        <div className="flex flex-col md:flex-row items-center gap-4 sm:gap-6 w-full md:w-auto">
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-indigo-500 text-white flex items-center justify-center shadow-lg shadow-indigo-500/20 shrink-0">
                <Cpu size={28} />
            </div>
            <div className="min-w-0">
                <h3 className="text-[15px] sm:text-xl font-black mb-1">Finish your EA Setup</h3>
                <p className={`text-[13px] sm:text-sm max-w-md mx-auto md:mx-0 leading-relaxed ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
                    You&apos;ve selected EA Sync, but we haven&apos;t received any data yet. Complete the setup to see your real-time trades and equity.
                </p>
            </div>
        </div>
        <button
            onClick={() => { try { haptic.light(); } catch {} onSetupClick(); }}
            className="min-h-[44px] w-full md:w-auto justify-center px-6 sm:px-8 py-3 sm:py-4 bg-indigo-500 hover:bg-indigo-600 active:scale-[0.98] text-white rounded-2xl font-black text-sm transition-all hover:scale-[1.02] shadow-xl shadow-indigo-500/20 flex items-center gap-2 shrink-0 touch-manipulation"
        >
            Setup Guide <ArrowRight size={18} />
        </button>
    </div>
);

interface StatCardProps {
    label: string;
    value: string | number;
    subtext?: string;
    trend?: number;
    isDarkMode: boolean;
    icon: React.ElementType;
    colorClass: string;
    tooltip?: string;
    onInfoClick?: () => void;
}

const StatCard = ({ label, value, subtext, trend, isDarkMode, icon: Icon, colorClass, tooltip, onInfoClick }: StatCardProps) => {
    const isInteractive = !!onInfoClick;
    const handleTap = useCallback(() => {
        if (!isInteractive) return;
        try { haptic.light(); } catch {}
        onInfoClick?.();
    }, [isInteractive, onInfoClick]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!isInteractive) return;
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleTap();
        }
    };

    return (
        <div
            role={isInteractive ? 'button' : undefined}
            tabIndex={isInteractive ? 0 : undefined}
            onClick={isInteractive ? handleTap : undefined}
            onKeyDown={isInteractive ? handleKeyDown : undefined}
            className={`h-full p-6 rounded-2xl border transition-all hover:shadow-lg ${isDarkMode ? 'bg-[#000000] border-[#27272a]' : 'bg-white border-slate-100 shadow-md'} ${isInteractive ? 'cursor-pointer active:scale-[0.98] touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4F01]/30' : ''}`}
        >
            <div className="flex justify-between items-start mb-4">
                <div className={`p-3 rounded-xl ${isDarkMode ? 'bg-[#27272a]' : 'bg-slate-50'}`}>
                    <Icon size={20} className={colorClass} />
                </div>
                {trend && (
                    <span className={`text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1 ${trend > 0 ? 'bg-teal-500/10 text-teal-500' : 'bg-rose-500/10 text-rose-500'}`}>
                        {trend > 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                        {Math.abs(trend)}%
                    </span>
                )}
            </div>
            <h3 className={`text-2xl font-bold mb-1 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{value}</h3>
            <div className="flex items-center gap-2">
                <p className={`text-xs font-medium uppercase tracking-wider opacity-50 ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>{label}</p>
            </div>
            {subtext && <p className="text-xs text-zinc-500 mt-2">{subtext}</p>}
            {isInteractive && <span className="sr-only">Tap for details</span>}
        </div>
    );
};

const formatDateLabel = (value?: string) => {
    if (!value) return 'TBA';

    const date = new Date(`${value}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return value;

    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
    }).format(date);
};

const impactStyleMap: Record<string, { pill: string; dot: string }> = {
    high: { pill: 'bg-rose-500/10 text-rose-500 border-rose-500/20', dot: 'bg-rose-500' },
    medium: { pill: 'bg-amber-500/10 text-amber-400 border-amber-500/20', dot: 'bg-amber-400' },
    low: { pill: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20', dot: 'bg-emerald-500' },
};

const EconomicCalendarWidget = ({ isDarkMode }: { isDarkMode: boolean }) => {
    const [events, setEvents] = useState<EconomicCalendarItem[]>([]);
    const [impactFilter, setImpactFilter] = useState<'all' | 'high' | 'med-high'>('all');
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<string | null>(null);
    const mountedRef = useRef(true);
    const hasEventsRef = useRef(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const todayAnchorRef = useRef<HTMLDivElement>(null);
    // Window: [today-3, today+7] always visible via scroll; opens on today.
    const { from: windowFrom, to: windowTo, today: todayStr } = getCalendarWindow();

    const loadCalendar = useCallback(async (options?: { silent?: boolean }) => {
        const silent = options?.silent ?? false;
        const hasExistingEvents = hasEventsRef.current;

        if (!silent) {
            if (!hasExistingEvents) {
                setIsLoading(true);
            } else {
                setIsRefreshing(true);
            }
        }

        setError(null);

        try {
            // Today-first window: max 3 days back + 7 days ahead, all scrollable.
            const { from, to } = getCalendarWindow(new Date());
            const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
            // Authenticated via economicCalendarClient (session JWT) with a
            // direct ForexFactory CDN fallback, so phone-web/APK both load it.
            const payload = await fetchEconomicCalendar({ from, to, tz: userTz });

            if (!mountedRef.current) return;

            const rawEvents = Array.isArray((payload as any)?.data) ? (payload as any).data : [];
            const normalizedEvents = rawEvents
                .filter((item: EconomicCalendarItem) => item && (item.event || item.Event) && item.date)
                .slice()
                .sort((a: EconomicCalendarItem, b: EconomicCalendarItem) => {
                    const aTs = Date.parse(`${a.date}T${a.time || '00:00:00'}Z`);
                    const bTs = Date.parse(`${b.date}T${b.time || '00:00:00'}Z`);
                    if (aTs !== bTs) return aTs - bTs;
                    return (a.currency || a.Currency || '').localeCompare(b.currency || b.Currency || '');
                });

            setEvents(normalizedEvents);
            hasEventsRef.current = normalizedEvents.length > 0;
            setLastUpdated(new Date().toISOString());
        } catch (fetchError) {
            if (!mountedRef.current) return;
            setError(fetchError instanceof Error ? fetchError.message : 'Failed to fetch economic calendar data.');
            setEvents([]);
            hasEventsRef.current = false;
        } finally {
            if (mountedRef.current) {
                setIsLoading(false);
                setIsRefreshing(false);
            }
        }
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        let cancelled = false;
        void loadCalendar();

        const refresh = () => {
            if (!cancelled) void loadCalendar({ silent: true });
        };

        const intervalId = window.setInterval(refresh, 30 * 60 * 1000);
        const onFocus = () => refresh();
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') refresh();
        };

        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVisibilityChange);

        return () => {
            cancelled = true;
            mountedRef.current = false;
            window.clearInterval(intervalId);
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, []);

    // Filter events by impact level. Window always [today-3, today+7]; list
    // opens scrolled to today so no scrolling past old news is needed.
    // Hard cap: never older than 3 days back, never beyond 7 days ahead.
    const filteredEvents = useMemo(() => {
        return events.filter((e) => {
            if (!e?.date) return false;
            if (e.date < windowFrom || e.date > windowTo) return false;
            const imp = (e.impact || e.Impact || '').toLowerCase();
            if (impactFilter === 'high') return imp === 'high';
            if (impactFilter === 'med-high') return imp === 'high' || imp === 'medium';
            return true;
        });
    }, [events, impactFilter, windowFrom, windowTo]);

    // Check for imminent High-Impact events within next 60 minutes
    const imminentHighImpactEvent = useMemo(() => {
        const now = Date.now();
        return events.find((e) => {
            const imp = (e.impact || e.Impact || '').toLowerCase();
            if (imp !== 'high') return false;
            const eventTimeStr = `${e.date}T${e.time || '00:00:00'}Z`;
            const eventTs = Date.parse(eventTimeStr);
            if (Number.isNaN(eventTs)) return false;
            const diffMinutes = (eventTs - now) / 60000;
            return diffMinutes >= -15 && diffMinutes <= 60;
        });
    }, [events]);

    const visibleEvents = filteredEvents;

    // First index with date >= today — the list auto-scrolls here on load
    // so today's news is what you see first; last 3 days are above via scroll.
    const todayAnchorIndex = useMemo(() => {
        const i = visibleEvents.findIndex((e) => e?.date && e.date >= todayStr);
        return i === -1 ? 0 : i;
    }, [visibleEvents, todayStr]);

    useEffect(() => {
        if (isLoading) return;
        const c = scrollRef.current;
        const t = todayAnchorRef.current;
        if (!c || !t) return;
        const cRect = c.getBoundingClientRect();
        const tRect = t.getBoundingClientRect();
        c.scrollTop += (tRect.top - cRect.top) - 8;
    }, [isLoading, impactFilter, filteredEvents.length]);

    return (
        <div className={`h-[400px] p-6 rounded-2xl border flex flex-col ${isDarkMode ? 'bg-[#000000] border-[#27272a]' : 'bg-white border-slate-100 shadow-md'}`}>
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-3 shrink-0">
                <div>
                    <h3 className="font-bold flex items-center gap-2">
                        <CalendarDays size={18} className="text-sky-500" />
                        Economic Calendar
                        <button
                            onClick={() => { try { haptic.light(); } catch {} void loadCalendar({ silent: false }); }}
                            disabled={isRefreshing || isLoading}
                            title="Refresh calendar data"
                            className={`p-1.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-all ${isDarkMode ? 'hover:bg-zinc-800 text-zinc-400 hover:text-white' : 'hover:bg-slate-100 text-slate-400 hover:text-slate-700'} disabled:opacity-50 touch-manipulation`}
                        >
                            <RefreshCw size={14} className={isRefreshing ? 'animate-spin text-sky-500' : ''} />
                        </button>
                    </h3>
                </div>
                
                {/* Impact Filter Controls */}
                <div className="flex items-center gap-1 bg-zinc-900/50 p-1 rounded-xl border border-zinc-800 self-start sm:self-auto flex-wrap">
                    <button
                        onClick={() => { try { haptic.selection(); } catch {} setImpactFilter('all'); }}
                        className={`px-2.5 py-1.5 min-h-[44px] sm:min-h-[30px] min-w-[44px] sm:min-w-0 text-[10px] font-black rounded-lg transition-all touch-manipulation ${impactFilter === 'all' ? 'bg-sky-500 text-white' : 'text-zinc-400 hover:text-white'}`}
                    >
                        ALL
                    </button>
                    <button
                        onClick={() => { try { haptic.selection(); } catch {} setImpactFilter('med-high'); }}
                        className={`px-2.5 py-1.5 min-h-[44px] sm:min-h-[30px] min-w-[44px] sm:min-w-0 text-[10px] font-black rounded-lg transition-all touch-manipulation ${impactFilter === 'med-high' ? 'bg-amber-500 text-white' : 'text-zinc-400 hover:text-white'}`}
                    >
                        MED+HIGH
                    </button>
                    <button
                        onClick={() => { try { haptic.selection(); } catch {} setImpactFilter('high'); }}
                        className={`px-2.5 py-1.5 min-h-[44px] sm:min-h-[30px] min-w-[44px] sm:min-w-0 text-[10px] font-black rounded-lg transition-all touch-manipulation ${impactFilter === 'high' ? 'bg-rose-500 text-white' : 'text-zinc-400 hover:text-white'}`}
                    >
                        HIGH ONLY
                    </button>
                </div>
            </div>

            {/* Imminent High Impact Warning Alert */}
            {imminentHighImpactEvent && (
                <div className={`mb-3 p-3 rounded-xl border flex items-center gap-3 animate-pulse ${isDarkMode ? 'bg-rose-500/10 border-rose-500/30 text-rose-400' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>
                    <AlertTriangle size={18} className="shrink-0 text-rose-500" />
                    <div className="min-w-0 flex-1">
                        <p className="text-xs font-black uppercase tracking-wider">High Impact News Warning</p>
                        <p className="text-xs truncate font-bold">
                            {imminentHighImpactEvent.currency || imminentHighImpactEvent.Currency} - {imminentHighImpactEvent.event || imminentHighImpactEvent.Event} ({imminentHighImpactEvent.time || 'Today'})
                        </p>
                    </div>
                </div>
            )}

            {isLoading ? (
                <div className="space-y-3 flex-1 overflow-hidden">
                    {[1, 2, 3, 4].map((index) => (
                        <div key={index} className={`p-3 rounded-xl border ${isDarkMode ? 'border-[#27272a] bg-white/[0.02]' : 'border-slate-100 bg-slate-50'}`}>
                            <div className="flex items-center justify-between gap-3 mb-2">
                                <div className="h-4 w-28 rounded bg-black/10 dark:bg-white/10" />
                                <div className="h-5 w-16 rounded-full bg-black/10 dark:bg-white/10" />
                            </div>
                            <div className="h-3 w-full rounded bg-black/10 dark:bg-white/10 mb-2" />
                            <div className="h-3 w-2/3 rounded bg-black/10 dark:bg-white/10" />
                        </div>
                    ))}
                </div>
            ) : error ? (
                <div className={`flex-1 rounded-2xl border border-dashed p-4 flex items-center gap-3 ${isDarkMode ? 'border-rose-500/20 bg-rose-500/5 text-rose-300' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
                    <AlertTriangle size={18} className="shrink-0" />
                    <div className="min-w-0">
                        <p className="text-sm font-bold">Could not load calendar</p>
                        <p className="text-xs opacity-80 truncate">{error}</p>
                    </div>
                </div>
            ) : visibleEvents.length === 0 ? (
                <div className={`flex-1 rounded-2xl border border-dashed flex flex-col items-center justify-center text-center px-6 py-8 gap-3 ${isDarkMode ? 'border-zinc-800 text-zinc-500' : 'border-slate-200 text-slate-400'}`}>
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isDarkMode ? 'bg-zinc-900 text-zinc-600' : 'bg-slate-100 text-slate-400'}`}>
                        <CalendarDays size={20} />
                    </div>
                    <div>
                        <p className="text-sm font-bold">No economic events in this window</p>
                        <p className="text-xs mt-1 max-w-[280px]">ForexFactory returned no scheduled events for the selected range or filter.</p>
                    </div>
                    <button onClick={() => { try { haptic.light(); } catch {} void loadCalendar({ silent: false }); }} className="min-h-[44px] mt-1 px-4 py-2 rounded-xl text-xs font-black border border-zinc-800 hover:bg-zinc-900 transition-colors touch-manipulation">Try again</button>
                </div>
            ) : (
                <div ref={scrollRef} className="space-y-3 flex-1 overflow-y-auto max-h-[290px] custom-scrollbar pr-2.5">
                    {visibleEvents.map((event, index) => {
                        const eventName = event.event || event.Event || 'Unnamed Event';
                        const currency = event.currency || event.Currency || 'USD';
                        const impactRaw = event.impact || event.Impact || 'low';
                        const impactKey = impactRaw.toLowerCase();
                        const impactStyle = impactStyleMap[impactKey] || {
                            pill: isDarkMode ? 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20' : 'bg-slate-100 text-slate-500 border-slate-200',
                            dot: 'bg-zinc-400',
                        };

                        const actualVal = event.actual || event.Actual || '--';
                        const forecastVal = event.forecast || event.Forecast || '--';
                        const previousVal = event.previous || event.Previous || '--';
                        const isToday = event.date === todayStr;

                        return (
                            <React.Fragment key={`${currency}-${event.date}-${eventName}-${index}`}>
                            {index === todayAnchorIndex && <div ref={todayAnchorRef} />}
                            <div className={`p-3 rounded-xl border ${isDarkMode ? 'border-[#27272a] bg-white/[0.02]' : 'border-slate-100 bg-slate-50'}`}>
                                <div className="flex items-start justify-between gap-3 mb-2">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <div className={`w-2 h-2 rounded-full ${impactStyle.dot}`} />
                                            <span className={`text-[10px] font-black uppercase px-1.5 py-0.5 rounded ${isDarkMode ? 'bg-zinc-800 text-zinc-300' : 'bg-slate-200 text-slate-700'}`}>
                                                {currency}
                                            </span>
                                            <p className="text-sm font-bold truncate">{eventName}</p>
                                        </div>
                                        <p className={`text-[10px] font-bold uppercase tracking-widest mt-1 ${isDarkMode ? 'text-zinc-500' : 'text-slate-400'}`}>
                                            {isToday ? (<><span className="text-sky-300">Today</span>{event.time ? ` | ${event.time}` : ''}</>) : (<>{formatDateLabel(event.date)} {event.time ? `| ${event.time}` : ''}</>)}
                                        </p>
                                    </div>
                                    <div className="flex flex-col items-end gap-1 shrink-0">
                                        <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-full border ${impactStyle.pill}`}>
                                            {impactKey}
                                        </span>
                                    </div>
                                </div>
                                <div className="grid grid-cols-3 gap-2 text-[11px]">
                                    <div className={`rounded-lg px-2 py-1.5 ${isDarkMode ? 'bg-black/30 text-zinc-300' : 'bg-white text-slate-600'}`}>
                                        <div className="opacity-50 uppercase tracking-widest font-bold text-[9px]">Actual</div>
                                        <div className="font-bold mt-0.5">{actualVal}</div>
                                    </div>
                                    <div className={`rounded-lg px-2 py-1.5 ${isDarkMode ? 'bg-black/30 text-zinc-300' : 'bg-white text-slate-600'}`}>
                                        <div className="opacity-50 uppercase tracking-widest font-bold text-[9px]">Forecast</div>
                                        <div className="font-bold mt-0.5">{forecastVal}</div>
                                    </div>
                                    <div className={`rounded-lg px-2 py-1.5 ${isDarkMode ? 'bg-black/30 text-zinc-300' : 'bg-white text-slate-600'}`}>
                                        <div className="opacity-50 uppercase tracking-widest font-bold text-[9px]">Previous</div>
                                        <div className="font-bold mt-0.5">{previousVal}</div>
                                    </div>
                                </div>
                            </div>
                            </React.Fragment>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
const DailyBiasWidget = React.memo(({ isDarkMode, dailyBias, onUpdateBias, onInfoClick, isDemoMode = false }: { isDarkMode: boolean, dailyBias: DailyBias[], onUpdateBias: (b: DailyBias) => void, onInfoClick?: () => void, isDemoMode?: boolean }) => {
    const days = useMemo(() => {
        if (isDemoMode) {
            return [...new Set(dailyBias.map((item) => item.date))].sort().slice(-7);
        }
        const now = new Date();
        const day = now.getDay(); // 0 (Sun) to 6 (Sat)
        // Adjust to make Monday the first day (1). If today is Sunday (0), we go back 6 days.
        const diff = now.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(now.setDate(diff));
        
        return Array.from({ length: 7 }, (_, i) => {
            const d = new Date(monday);
            d.setDate(monday.getDate() + i);
            return getSASTDateTime(d).date;
        });
    }, [dailyBias, isDemoMode]);

    const today = useMemo(() => getSASTDateTime().date, []);

    const biasMap = useMemo(() => {
        const map: Record<string, string> = {};
        dailyBias.forEach(b => {
            map[b.date] = b.bias;
        });
        return map;
    }, [dailyBias]);

    const handleCycleBias = (date: string) => {
        try { haptic.selection(); } catch {}
        const currentBiasObj = dailyBias.find(b => b.date === date);
        const current = currentBiasObj?.bias || 'Neutral';
        let next: 'Bullish' | 'Bearish' | 'Neutral' = 'Bullish';
        if (current === 'Bullish') next = 'Bearish';
        else if (current === 'Bearish') next = 'Neutral';
        else next = 'Bullish';
        
        onUpdateBias({ 
            ...(currentBiasObj || { date, notes: '', actualOutcome: 'Neutral' }), 
            bias: next 
        });
    };

    return (
        <div className={`h-full p-6 rounded-2xl border flex flex-col ${isDarkMode ? 'bg-[#000000] border-zinc-800 shadow-2xl' : 'bg-white border-slate-100 shadow-md'}`}>
            <div className="flex items-center justify-between mb-6">
                <h3 className="font-bold flex items-center gap-2"><Zap size={18} className="text-yellow-500" /> Daily Bias</h3>
            </div>
            <div className="grid grid-cols-7 gap-2 flex-1 items-center">
                {days.map(date => {
                    const bias = biasMap[date] || 'Neutral';
                    const dateObj = new Date(date);
                    const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
                    const dayIdx = dateObj.getDay(); // 0 is Sun, 6 is Sat
                    const isWeekend = dayIdx === 0 || dayIdx === 6;
                    const isToday = !isDemoMode && date === today;

                    return (
                        <button
                            key={date}
                            onClick={() => handleCycleBias(date)}
                            className={`flex flex-col items-center justify-center p-2 rounded-xl transition-all h-full ${
                                bias === 'Bullish' ? 'bg-teal-500/10 text-teal-500 border border-teal-500/20' :
                                bias === 'Bearish' ? 'bg-rose-500/10 text-rose-500 border border-rose-500/20' :
                                isWeekend 
                                    ? (isDarkMode ? 'bg-zinc-500/5 text-zinc-600 border border-zinc-800/50' : 'bg-slate-50 text-slate-300 border border-slate-100')
                                    : (isDarkMode ? 'bg-black text-zinc-500 border border-zinc-700' : 'bg-slate-100 text-slate-400 border border-slate-200')
                                } ${isToday ? 'ring-2 ring-blue-500' : ''}`}
                        >
                            <span className="text-[10px] font-bold mb-1">{dayName}</span>
                            {bias === 'Bullish' && <ArrowUpRight size={16} />}
                            {bias === 'Bearish' && <ArrowDownRight size={16} />}
                            {bias === 'Neutral' && <div className="w-4 h-4 rounded-full border-2 border-current border-dashed" />}
                        </button>
                    )
                })}
            </div>
        </div>
    );
});



const DASHBOARD_PRESETS = {
    STANDARD: ['dailyBias', 'equityCurve', 'recentTrades', 'openPositions'],
    EXECUTION: ['openPositions', 'equityCurve', 'recentTrades', 'dailyBias'],
    ANALYTICS: ['equityCurve', 'recentTrades', 'dailyBias', 'openPositions']
};

const Dashboard: React.FC<DashboardProps> = ({ isDarkMode, trades, dailyBias, onUpdateBias, userProfile, onViewChange, eaSession, lastKnownBridgeBalance, isBridgeOnline = false, isLoading, offlineQueue = [], isDemoMode = false, ctraderAccountId, ctraderPortfolioId, userTimezone }) => {
    // Robust free tier check
    const currentPlan = normalizePlan(userProfile?.plan);
    const isFreeTier = !userProfile || currentPlan === APP_CONSTANTS.PLANS.FREE;
    const ctraderSymbols = useCtraderSymbols(ctraderAccountId);
    const [activeInfo, setActiveInfo] = useState<{ title: string, content: string } | null>(null);
    // Widgets State for Reordering
    const [widgetOrder, setWidgetOrder] = useLocalStorage('dashboard_widget_order', DASHBOARD_PRESETS.STANDARD);

    // Ensure new widgets are added to existing layouts
    useEffect(() => {
        const allWidgets = [
            'dailyBias', 'recentTrades', 'equityCurve', 'openPositions'
        ];
        const missing = allWidgets.filter(id => !widgetOrder.includes(id));
        if (missing.length > 0) {
            setWidgetOrder(prev => [...prev, ...missing]);
        }
    }, []);
    
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const equityData = useMemo(() => {
        let cumulative = 0;
        const data = [0];
        sortTradesChronologically(trades)
            .forEach(t => {
                cumulative += Number.isFinite(Number(t.pnl)) ? Number(t.pnl) : 0;
                data.push(cumulative);
            });
        return data;
    }, [trades]);

    const totalFloatingPnL = useMemo(() => {
        return (eaSession?.data?.openPositions || []).reduce((sum: number, pos: any) => sum + Number(pos.profit || 0), 0);
    }, [eaSession]);

    // Streak / momentum tracking (progressive disclosure + motivation).
    const streakInfo = useMemo(() => {
        if (trades.length === 0) return null;
        const sorted = sortTradesChronologically([...trades]);
        let currentStreak = 0;
        let currentType: 'Win' | 'Loss' | null = null;
        // walk backwards from most recent
        for (let i = sorted.length - 1; i >= 0; i--) {
            const r = sorted[i].result;
            if (r !== 'Win' && r !== 'Loss') break;
            if (currentType === null) {
                currentType = r as 'Win' | 'Loss';
                currentStreak = 1;
            } else if (r === currentType) {
                currentStreak++;
            } else break;
        }
        if (!currentType) return null;
        return { count: currentStreak, type: currentType };
    }, [trades]);

    const InfoPanel = ({ info, onClose }: { info: { title: string, content: string }, onClose: () => void }) => (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-6 sm:p-12 animate-in fade-in duration-300">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
            <div className={`relative w-full max-w-lg p-8 rounded-[32px] border shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-8 duration-300 ${isDarkMode ? 'bg-black border-zinc-800' : 'bg-white border-slate-200'}`}>
                <button 
                    onClick={onClose}
                    className={`absolute top-6 right-6 p-2 rounded-xl transition-all ${isDarkMode ? 'hover:bg-white/5' : 'hover:bg-black/5'}`}
                >
                    <X size={20} className={isDarkMode ? 'text-zinc-400' : 'text-slate-500'} />
                </button>
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-2.5 rounded-2xl bg-[#FF4F01]/10 text-[#FF4F01]">
                        <Info size={24} />
                    </div>
                    <h3 className="text-2xl font-black tracking-tight">Help: {info.title}</h3>
                </div>
                <div className={`text-sm leading-relaxed space-y-4 font-medium ${isDarkMode ? 'text-zinc-400' : 'text-slate-600'}`}>
                    {info.content.split('\n\n').map((para, i) => (
                        <p key={i}>{para}</p>
                    ))}
                </div>
                <button 
                    onClick={onClose}
                    className="w-full mt-10 py-4 bg-[#FF4F01] hover:bg-[#E64601] text-white rounded-2xl font-black text-sm transition-all shadow-xl shadow-[#FF4F01]/20"
                >
                    Got it, thanks!
                </button>
            </div>
        </div>
    );

    if (isLoading) {
        return (
            <div className={`w-full h-full overflow-y-auto p-8 font-sans ${isDarkMode ? 'bg-black text-zinc-200' : 'bg-slate-50 text-slate-900'}`}>
                <header className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="space-y-2">
                        <Skeleton className="w-64 h-10" />
                        <Skeleton className="w-48 h-4" />
                    </div>
                    <Skeleton className="w-80 h-20 rounded-3xl" />
                </header>
                <DashboardSkeleton isDarkMode={isDarkMode} />
            </div>
        );
    }

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (active && over && active.id !== over.id) {
            try { haptic.selection(); } catch {}
            setWidgetOrder((items) => {
                const oldIndex = items.indexOf(String(active.id));
                const newIndex = items.indexOf(String(over.id));
                return arrayMove(items, oldIndex, newIndex);
            });
        }
    };

    // Calculate Stats (memoized: runs once per trade-list change, not per render)
    const { totalPnL, wins, losses, winRate, profitFactor } = useMemo(() => {
        const pnl = trades.reduce((acc, t) => acc + (Number.isFinite(Number(t.pnl)) ? Number(t.pnl) : 0), 0);
        const w = trades.filter(t => t.result === 'Win');
        const l = trades.filter(t => t.result === 'Loss');
        const wr = trades.length > 0 ? ((w.length / trades.length) * 100).toFixed(1) : 0;
        const grossProfit = w.reduce((acc, t) => acc + safePnL(t.pnl), 0);
        const grossLoss = Math.abs(l.reduce((acc, t) => acc + safePnL(t.pnl), 0));
        const pf = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : (grossProfit > 0 ? "9.9" : "0.00");
        return { totalPnL: pnl, wins: w, losses: l, winRate: wr, profitFactor: pf };
    }, [trades]);
    const isPro = currentPlan === APP_CONSTANTS.PLANS.HOBBY;

    const hasNoTrades = trades.length === 0 && !isDemoMode;

    const LockedView = ({ title, subtitle }: { title: string, subtitle: string }) => (
        <div className={`h-full w-full p-6 rounded-2xl border flex flex-col items-center justify-center text-center relative overflow-hidden ${isDarkMode ? 'bg-[#000000] border-[#27272a]' : 'bg-white border-slate-100 shadow-md'}`}>
            <div className="absolute inset-0 bg-black/5 dark:bg-white/[0.02] backdrop-blur-[2px] z-10" />
            <div className="relative z-20 flex flex-col items-center gap-3">
                <div className="p-3 rounded-2xl bg-[#FF4F01]/10 text-[#FF4F01] shadow-xl shadow-[#FF4F01]/10">
                    <Lock size={24} />
                </div>
                <div>
                    <h4 className="text-sm font-black uppercase tracking-widest mb-1">{title}</h4>
                    <p className="text-[10px] font-bold opacity-40 px-6 leading-relaxed">{subtitle}</p>
                </div>
                <button
                    onClick={() => { try { haptic.light(); } catch {} onViewChange('settings'); }}
                    className="mt-2 px-6 py-2 bg-[#FF4F01] text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-[#FF4F01]/20 hover:scale-105 active:scale-95 transition-all touch-manipulation"
                >
                    Upgrade to Unlock
                </button>
            </div>
        </div>
    );

    const renderWidget = (id: string) => {
        if (isFreeTier && (id === 'dailyBias' || id === 'openPositions')) {
            return (
                <LockedView 
                    title={id === 'dailyBias' ? "Daily Bias" : "Open Positions"} 
                    subtitle={id === 'dailyBias' ? "Stay aligned with market direction. Upgrade to PRO to use the Daily Bias tracker." : "Monitor your live trades in real-time. Upgrade to PRO to unlock the Live Bridge."} 
                />
            );
        }

        switch (id) {
            case 'dailyBias':
                return <DailyBiasWidget 
                    isDarkMode={isDarkMode} 
                    dailyBias={dailyBias} 
                    onUpdateBias={onUpdateBias} 
                    isDemoMode={isDemoMode}
                    onInfoClick={() => setActiveInfo({
                        title: "Daily Bias",
                        content: "Daily Bias tracks your overarching market sentiment for the day. By recording whether you are Bullish, Bearish, or Neutral before you trade, you can later analyze if your trades were aligned with your higher-time-frame outlook.\n\nSuccessful traders often find that their best performance comes when they trade in the direction of their pre-defined bias."
                    })}
                />;
            case 'recentTrades':
                return <EconomicCalendarWidget isDarkMode={isDarkMode} />;
            case 'equityCurve':
                return <EquityCurveWidget trades={trades} equityData={equityData} isDarkMode={isDarkMode} currencySymbol={userProfile.currencySymbol} hideCurrentValue={!isFreeTier && trades.length === 0} isLoading={isLoading} />;
            case 'openPositions':
                if (ctraderAccountId && !isDemoMode) {
                    return (
                        <div className="h-full min-h-[300px] rounded-2xl border border-zinc-800 bg-black p-2 text-zinc-200 sm:p-3">
                            <div className="flex items-center justify-between px-2 py-1.5">
                                <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                                    <Activity size={18} className="text-emerald-500" /> Open Positions
                                </h3>
                                <button
                                    type="button"
                                    onClick={() => onViewChange('trade')}
                                    className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-[#FF4F01] hover:text-[#ff7a3d]"
                                >
                                    Trade <ArrowRight size={12} />
                                </button>
                            </div>
                            <Suspense fallback={<div className="py-8 text-center text-[11px] text-zinc-500">Loading cTrader positions…</div>}>
                                <CtraderAccountPanel
                                    ctidAccountId={ctraderAccountId}
                                    portfolioId={ctraderPortfolioId}
                                    timezone={userTimezone}
                                    onGoConnect={() => onViewChange('ea-setup')}
                                    mode="positions"
                                    symbols={ctraderSymbols.symbols}
                                    isDemo={ctraderSymbols.isDemo}
                                    isLoadingSymbols={ctraderSymbols.isLoading}
                                    symbolsError={ctraderSymbols.error}
                                    onRefreshSymbols={ctraderSymbols.reload}
                                />
                            </Suspense>
                        </div>
                    );
                }
                if (!userProfile.eaConnected) {
                    // Stale cached sessions would show ghost positions — the
                    // widget is only meaningful with an active bridge.
                    return (
                        <div className={`h-full p-6 rounded-2xl border flex flex-col items-center justify-center gap-2 ${isDarkMode ? 'bg-[#000000] border-zinc-800 shadow-2xl' : 'bg-white border-slate-100 shadow-md'}`}>
                            <Activity size={22} className="text-zinc-600" />
                            <p className={`text-sm font-bold ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>No active bridge connection</p>
                            <p className={`text-xs ${isDarkMode ? 'text-zinc-600' : 'text-slate-400'}`}>Connect Desktop Bridge to see live open positions.</p>
                        </div>
                    );
                }
                return (
                    <div className={`h-full p-6 rounded-2xl border flex flex-col ${isDarkMode ? 'bg-[#000000] border-zinc-800 shadow-2xl' : 'bg-white border-slate-100 shadow-md'}`}>
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                                <h3 className="font-bold flex items-center gap-2"><Activity size={18} className="text-emerald-500" /> Open Positions</h3>
                                {eaSession && (
                                    <Tooltip content={`Last Synced: ${new Date(eaSession.last_updated).toLocaleString()}`} isDarkMode={isDarkMode}>
                                        <div className="flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-zinc-500/10 text-zinc-500 border border-zinc-500/20">
                                            <div className="w-1 h-1 rounded-full bg-zinc-500" />
                                            <span className="text-[8px] font-black uppercase tracking-widest">Cached</span>
                                        </div>
                                    </Tooltip>
                                )}
                            </div>
                            <div className="text-right">
                                <div className={`text-lg font-black font-mono leading-none ${totalFloatingPnL >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                    {totalFloatingPnL >= 0 ? '+' : ''}{userProfile.currencySymbol}{totalFloatingPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </div>
                                <div className="text-[10px] font-bold opacity-40 uppercase tracking-widest mt-1">Total Floating P/L</div>
                            </div>
                        </div>
                        <OpenPositions
                            positions={(eaSession?.data?.openPositions || []).map((p: any) => ({
                                ...p,
                                lots: p.volume,
                                openTime: p.time ? new Date(p.time * 1000).toISOString() : '',
                                openPrice: p.open_price,
                                currentPrice: p.current_price,
                                profit: p.profit
                            }))}
                            isDarkMode={isDarkMode}
                            currencySymbol={userProfile.currencySymbol}
                            lastUpdated={eaSession?.last_updated}
                        />
                    </div>
                );
            default: return null;
        }
    };

    // Helper to determine col-span based on ID
    const getColSpan = (id: string) => {
        if (id === 'recentTrades') return 'col-span-1 min-h-[280px]';
        if (id === 'equityCurve') return 'col-span-1 lg:col-span-2 min-h-[320px]';
        // Daily Bias and Open Positions should take full width to avoid the large gap on the right
        return 'col-span-1 lg:col-span-3 min-h-[250px]';
    };

    return (
        <div className={`w-full h-full overflow-y-auto custom-scrollbar p-4 sm:p-8 pb-nav font-sans ${isDarkMode ? 'bg-[#000000] text-zinc-200' : 'bg-slate-50 text-slate-900'}`}>
            <header className="mb-6 flex flex-col md:flex-row md:items-center justify-start gap-4 sm:gap-6">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 sm:gap-3 mb-1 flex-wrap min-w-0">
                        <h1 className="text-[20px] sm:text-3xl font-bold tracking-tight truncate min-w-0">{userProfile.accountName || 'Trading Dashboard'}</h1>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest border shrink-0 ${isDarkMode ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20' : 'bg-indigo-50 text-indigo-600 border-indigo-200'}`}>
                            {userProfile.experienceLevel}
                        </span>
                        {isDemoMode && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest border border-amber-500/30 bg-amber-500/10 text-amber-300 shrink-0">
                                Demo Mode
                            </span>
                        )}
                        {/* Streak / momentum badge — progressive disclosure next to the level pill */}
                        {streakInfo && !isDemoMode && trades.length > 0 && (
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border shrink-0 ${streakInfo.type === 'Win' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>
                                <Flame size={12} className={streakInfo.type === 'Win' ? 'text-emerald-400' : 'text-rose-400'} />
                                {streakInfo.count}× {streakInfo.type} streak
                            </span>
                        )}
                    </div>
                    <p className={`text-[13px] sm:text-sm break-words ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>
                        {isDemoMode ? 'Sample journal — 3 months of trades & analytics.' : `Welcome back, ${userProfile.name}. Analyzing markets from ${userProfile.country}.`}
                    </p>
                </div>

        </header>

            {/* EA Setup Prompt (For new EA users) — hidden in demo mode */}
            {!isDemoMode && trades.length === 0 && userProfile.syncMethod === 'EA_CONNECT' && !eaSession && (
                <EASetupPrompt isDarkMode={isDarkMode} onSetupClick={() => onViewChange('ea-setup')} />
            )}

            {/* MobileEmptyState for no trades — illustrative + CTA to Log (hidden in demo/EA prompt) */}
            {hasNoTrades && userProfile.syncMethod !== 'EA_CONNECT' && (
                <div className="mb-6">
                    <MobileEmptyState isDarkMode={isDarkMode} onCta={() => onViewChange('log-trade')} isFreeTier={isFreeTier} />
                </div>
            )}

            {/* Session Clock Widget (Fixed at Top) — compact on mobile via wrapper */}
            <div className="mb-6 [&>div]:!p-4 sm:[&>div]:!p-6 [&>div]:!rounded-2xl [&>div]:!mb-0">
                <SessionClock isDarkMode={isDarkMode} />
            </div>

            {/* Daily Quote Insight — compact on mobile via wrapper */}
            <div className="mb-6 [&>div]:!p-4 sm:[&>div]:!p-6 [&>div]:!rounded-2xl [&>div]:!mb-0">
                <DailyQuote isDarkMode={isDarkMode} />
            </div>

            {ctraderAccountId && !isDemoMode && (
                <div className="mb-6 rounded-2xl border border-zinc-800 bg-black p-3 text-zinc-200">
                    <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-1">
                        <div>
                            <h2 className="text-sm font-black text-white">cTrader Account</h2>
                            <p className="text-[11px] text-zinc-500">Balance, equity, margin, and open positions from your linked account.</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => onViewChange('trade')}
                                className="inline-flex h-8 items-center gap-1 rounded-lg bg-[#FF4F01] px-3 text-[10px] font-black uppercase tracking-widest text-white hover:brightness-110"
                            >
                                Open trading <ArrowRight size={12} />
                            </button>
                            <button
                                type="button"
                                onClick={() => onViewChange('quotes')}
                                className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/10 px-3 text-[10px] font-black uppercase tracking-widest text-zinc-300 hover:bg-white/5"
                            >
                                Quotes
                            </button>
                        </div>
                    </div>
                    <Suspense fallback={<div className="py-6 text-center text-[11px] text-zinc-500">Loading cTrader account…</div>}>
                        <CtraderAccountPanel
                            ctidAccountId={ctraderAccountId}
                            portfolioId={ctraderPortfolioId}
                            timezone={userTimezone}
                            onGoConnect={() => onViewChange('ea-setup')}
                            mode="summary"
                            symbols={ctraderSymbols.symbols}
                            isDemo={ctraderSymbols.isDemo}
                            isLoadingSymbols={ctraderSymbols.isLoading}
                            symbolsError={ctraderSymbols.error}
                            onRefreshSymbols={ctraderSymbols.reload}
                        />
                    </Suspense>
                </div>
            )}

            {/* Stats Row (Fixed) */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <StatCard 
                    label="Net PnL" 
                    value={`${userProfile.currencySymbol}${totalPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} 
                    isDarkMode={isDarkMode} 
                    icon={DollarSign} 
                    colorClass="text-blue-500" 
                    tooltip="The total realized profit or loss from all closed trades."
                    onInfoClick={() => setActiveInfo({
                        title: "Net P&L",
                        content: "Net P&L (Profit and Loss) is the total amount of money you have made or lost from all closed trades, after accounting for commissions and swaps.\n\nIt is the 'Bottom Line' of your trading journal and represents your actual realized growth or decay of capital."
                    })}
                />
                <StatCard 
                    label="Win Rate" 
                    value={`${winRate}%`} 
                    subtext={`${wins.length}W - ${losses.length}L`} 
                    isDarkMode={isDarkMode} 
                    icon={Gauge} 
                    colorClass="text-purple-500" 
                    tooltip="The percentage of closed trades that resulted in a profit."
                    onInfoClick={() => setActiveInfo({
                        title: "Win Rate",
                        content: "Win Rate is the percentage of your total trades that ended in a profit. It is calculated as (Winning Trades / Total Trades) * 100.\n\nWhile a high win rate is encouraging, it must be balanced with your Reward-to-Risk ratio. A trader with a 30% win rate can still be highly profitable if their average win is much larger than their average loss."
                    })}
                />
                <StatCard 
                    label="Profit Factor" 
                    value={profitFactor} 
                    isDarkMode={isDarkMode} 
                    icon={Zap} 
                    colorClass="text-teal-500" 
                    tooltip="Gross Profit divided by Gross Loss. A value above 1.0 means profitability."
                    onInfoClick={() => setActiveInfo({
                        title: "Profit Factor",
                        content: "Profit Factor is a measure of how much profit you make for every dollar you lose. It is calculated as Gross Profit / Gross Loss.\n\nA profit factor above 1.0 indicates a profitable strategy. Professional traders typically aim for a profit factor between 1.5 and 2.5."
                    })}
                />
                <StatCard 
                    label="Total Trades" 
                    value={trades.length} 
                    isDarkMode={isDarkMode} 
                    icon={BarChart2} 
                    colorClass="text-orange-500" 
                    tooltip="The total number of trades logged in your history."
                    onInfoClick={() => setActiveInfo({
                        title: "Total Trades",
                        content: "Total Trades represents the volume of activity in your journal. It includes all Wins, Losses, and Breakeven trades.\n\nTracking total trades is essential for statistical significance. The more trades you log, the more reliable your other analytics (like Win Rate and Profit Factor) become."
                    })}
                />
            </div>

            {/* Draggable Widget Grid — gap-3 mobile, gap-6 lg; haptics on drag */}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={widgetOrder} strategy={rectSortingStrategy}>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 lg:gap-6 pb-6">
                        {widgetOrder.map(id => (
                            <SortableWidget key={id} id={id} className={`${getColSpan(id)} [&>div]:!p-4 sm:[&>div]:!p-6 [&>div]:!rounded-2xl`}>
                                {renderWidget(id)}
                            </SortableWidget>
                        ))}
                    </div>
                </SortableContext>
            </DndContext>

            {/* Inline FAB fallback — AI Copilot — visible only if MobileQuickActions not mounted by App shell (thumb zone). Hidden on lg via media query; respects safe-area. */}
            {!isDemoMode && hasNoTrades && (
                <button
                    onClick={() => { try { haptic.light(); } catch {} onViewChange('ai-chat'); }}
                    aria-label="AI Strategy Copilot"
                    className="sm:hidden fixed bottom-[calc(5.25rem+env(safe-area-inset-bottom)+16px)] right-4 z-40 w-14 h-14 rounded-full bg-white/[0.10] backdrop-blur-2xl border border-white/[0.14] text-white flex items-center justify-center shadow-[0_8px_32px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.10)] active:scale-95 transition-all touch-manipulation"
                >
                    <Sparkles size={26} strokeWidth={2.2} className="text-white" />
                </button>
            )}

            {activeInfo && (
                <InfoPanel 
                    info={activeInfo} 
                    onClose={() => setActiveInfo(null)} 
                />
            )}
        </div>
    );
};

export default Dashboard;
