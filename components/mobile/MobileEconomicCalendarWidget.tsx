import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { CalendarDays, RefreshCw, AlertTriangle } from 'lucide-react';
import { fetchEconomicCalendar, getCalendarWindow } from '../../lib/economicCalendarClient';

type EconomicCalendarItem = {
  event?: string; Event?: string;
  currency?: string; Currency?: string;
  impact?: string; Impact?: string;
  date: string;
  time?: string;
  actual?: string; Actual?: string;
  forecast?: string; Forecast?: string;
  previous?: string; Previous?: string;
};

const impactStyleMap: Record<string, { pill: string; dot: string }> = {
  high: { pill: 'text-rose-400', dot: 'bg-rose-500' },
  medium: { pill: 'text-amber-400', dot: 'bg-amber-500' },
  low: { pill: 'text-zinc-400', dot: 'bg-zinc-400' },
};

const formatDateLabel = (dateStr: string) => {
  try { const d = new Date(dateStr); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { return dateStr; }
};

export const MobileEconomicCalendarWidget: React.FC = () => {
  const [events, setEvents] = useState<EconomicCalendarItem[]>([]);
  const [impactFilter, setImpactFilter] = useState<'all' | 'high' | 'med-high'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const hasEventsRef = useRef(false);
  // Window: [today-3, today+7] always visible via scroll; opens on today.
  const { from: windowFrom, to: windowTo, today: todayStr } = getCalendarWindow();

  const loadCalendar = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    const hasExistingEvents = hasEventsRef.current;
    if (!silent) {
      if (!hasExistingEvents) setIsLoading(true);
      else setIsRefreshing(true);
    }
    setError(null);
    try {
      // Today-first window: max 3 days back + 7 days ahead, all scrollable.
      const { from, to } = getCalendarWindow(new Date());
      const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      // Native-safe: hosted /api first, then direct ForexFactory CDN fallback for APK.
      const payload = await fetchEconomicCalendar({ from, to, tz: userTz });
      if (!mountedRef.current) return;
      const rawEvents = Array.isArray((payload as any)?.data) ? (payload as any).data : [];
      const normalized = rawEvents
        .filter((item: EconomicCalendarItem) => item && (item.event || item.Event) && item.date)
        .slice()
        .sort((a: EconomicCalendarItem, b: EconomicCalendarItem) => {
          const aTs = Date.parse(`${a.date}T${a.time || '00:00:00'}Z`);
          const bTs = Date.parse(`${b.date}T${b.time || '00:00:00'}Z`);
          if (aTs !== bTs) return aTs - bTs;
          return (a.currency || a.Currency || '').localeCompare(b.currency || b.Currency || '');
        });
      setEvents(normalized);
      hasEventsRef.current = normalized.length > 0;
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
    void loadCalendar();
    const intervalId = window.setInterval(() => void loadCalendar({ silent: true }), 30 * 60 * 1000);
    const onFocus = () => void loadCalendar({ silent: true });
    const onVisibilityChange = () => { if (document.visibilityState === 'visible') void loadCalendar({ silent: true }); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      mountedRef.current = false;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [loadCalendar]);

  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      if (!e?.date) return false;
      // Hard cap: never older than 3 days back, never beyond 7 days ahead.
      if (e.date < windowFrom || e.date > windowTo) return false;
      const imp = (e.impact || e.Impact || '').toLowerCase();
      if (impactFilter === 'high') return imp === 'high';
      if (impactFilter === 'med-high') return imp === 'high' || imp === 'medium';
      return true;
    });
  }, [events, impactFilter, windowFrom, windowTo]);

  const EVENTS_PER_PAGE = 3;
  const pages = useMemo(() => {
    const chunks: EconomicCalendarItem[][] = [];
    for (let i = 0; i < filteredEvents.length; i += EVENTS_PER_PAGE) chunks.push(filteredEvents.slice(i, i + EVENTS_PER_PAGE));
    return chunks;
  }, [filteredEvents]);
  // Open on today's page (not the 3-day-old history): first page with date >= today.
  const todayPageIndex = useMemo(() => {
    const idx = filteredEvents.findIndex((e) => e?.date && e.date >= todayStr);
    if (idx === -1) return Math.max(0, pages.length - 1);
    return Math.floor(idx / EVENTS_PER_PAGE);
  }, [filteredEvents, pages.length, todayStr]);
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(todayPageIndex); }, [impactFilter, filteredEvents.length, todayPageIndex]);
  const touchStartX = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => { touchStartX.current = e.touches[0].clientX; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) < 50) return;
    if (dx < 0 && page < pages.length - 1) setPage(p => p + 1);
    if (dx > 0 && page > 0) setPage(p => p - 1);
  };

  const imminentHighImpactEvent = useMemo(() => {
    const now = Date.now();
    return events.find((e) => {
      const imp = (e.impact || e.Impact || '').toLowerCase();
      if (imp !== 'high') return false;
      const eventTs = Date.parse(`${e.date}T${e.time || '00:00:00'}Z`);
      if (Number.isNaN(eventTs)) return false;
      const diffMinutes = (eventTs - now) / 60000;
      return diffMinutes >= -15 && diffMinutes <= 60;
    });
  }, [events]);

  return (
    <div className="jfx-card p-4 flex flex-col">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="jfx-label flex items-center gap-2 min-w-0 truncate">
          <CalendarDays size={14} className="text-sky-500 shrink-0" />
          Economic Calendar
        </h3>
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="inline-flex items-center gap-px bg-zinc-900 rounded-md p-px border border-zinc-800/50">
            <button onClick={() => setImpactFilter('all')} className={`px-1.5 py-0 text-[9px] font-medium rounded transition-colors leading-none ${impactFilter === 'all' ? 'bg-[#FF4F01] text-white' : 'text-zinc-500 hover:text-zinc-300'}`}>All</button>
            <button onClick={() => setImpactFilter('med-high')} className={`px-1.5 py-0 text-[9px] font-medium rounded transition-colors leading-none ${impactFilter === 'med-high' ? 'bg-[#FF4F01] text-white' : 'text-zinc-500 hover:text-zinc-300'}`}>Med+High</button>
            <button onClick={() => setImpactFilter('high')} className={`px-1.5 py-0 text-[9px] font-medium rounded transition-colors leading-none ${impactFilter === 'high' ? 'bg-[#FF4F01] text-white' : 'text-zinc-500 hover:text-zinc-300'}`}>High</button>
          </div>
          <button onClick={() => void loadCalendar({ silent: false })} disabled={isRefreshing || isLoading} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-zinc-800 text-zinc-500 disabled:opacity-50">
            <RefreshCw size={12} className={isRefreshing ? 'animate-spin text-sky-500' : ''} />
          </button>
        </div>
      </div>

      {imminentHighImpactEvent && (
        <div className="mb-3 p-3 rounded-xl border flex items-center gap-2 bg-rose-500/10 border-rose-500/20 text-rose-400 animate-pulse">
          <AlertTriangle size={14} className="shrink-0" />
          <p className="text-xs font-bold truncate">{imminentHighImpactEvent.currency || imminentHighImpactEvent.Currency} — {imminentHighImpactEvent.event || imminentHighImpactEvent.Event}</p>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[1,2,3].map(i => <div key={i} className="h-16 rounded-xl bg-zinc-900 animate-pulse" />)}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-dashed border-rose-500/20 bg-rose-500/5 p-3 flex items-center gap-2 text-rose-300">
          <AlertTriangle size={14} className="shrink-0" />
          <p className="text-xs truncate">{error}</p>
        </div>
      ) : filteredEvents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-800 p-6 flex flex-col items-center text-center gap-2 text-zinc-500">
          <CalendarDays size={18} className="text-zinc-600" />
          <p className="text-xs font-bold">No economic events in this window</p>
          <button onClick={() => void loadCalendar({ silent: false })} className="mt-1 px-3 py-1.5 rounded-lg border border-zinc-800 text-xs font-bold hover:bg-zinc-900">Try again</button>
        </div>
      ) : (
        <div className="select-none" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <div className="space-y-2 min-h-[240px]">
            {(pages[page] || []).map((event, index) => {
            const eventName = event.event || event.Event || 'Unnamed Event';
            const currency = event.currency || event.Currency || 'USD';
            const impactKey = (event.impact || event.Impact || 'low').toLowerCase();
            const impactStyle = impactStyleMap[impactKey] || impactStyleMap.low;
            const actualVal = event.actual || event.Actual || '--';
            const forecastVal = event.forecast || event.Forecast || '--';
            const previousVal = event.previous || event.Previous || '--';
            const isToday = event.date === todayStr;
            return (
              <div key={`${currency}-${event.date}-${eventName}-${index}`} className="p-3 rounded-xl border border-zinc-800 bg-white/[0.02]">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${impactStyle.dot}`} />
                      <span className="text-[10px] font-black uppercase text-zinc-300">{currency}</span>
                      <p className="text-xs font-bold truncate flex-1 min-w-0">{eventName}</p>
                    </div>
                    <p className="text-[10px] font-bold uppercase tracking-widest mt-1 text-zinc-500">{isToday ? (<><span className="text-sky-300">Today</span>{event.time ? ` | ${event.time}` : ''}</>) : (<>{formatDateLabel(event.date)} {event.time ? `| ${event.time}` : ''}</>)}</p>
                  </div>
                  <span className={`text-[10px] font-black uppercase tracking-widest shrink-0 ${impactStyle.pill}`}>{impactKey}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  <div className="rounded-lg px-2 py-1.5 bg-black/30 text-zinc-300"><div className="opacity-50 uppercase tracking-widest font-bold text-[8px]">Actual</div><div className="font-bold mt-0.5 truncate">{actualVal}</div></div>
                  <div className="rounded-lg px-2 py-1.5 bg-black/30 text-zinc-300"><div className="opacity-50 uppercase tracking-widest font-bold text-[8px]">Forecast</div><div className="font-bold mt-0.5 truncate">{forecastVal}</div></div>
                  <div className="rounded-lg px-2 py-1.5 bg-black/30 text-zinc-300"><div className="opacity-50 uppercase tracking-widest font-bold text-[8px]">Previous</div><div className="font-bold mt-0.5 truncate">{previousVal}</div></div>
                </div>
              </div>
            );
          })}
          </div>
          {pages.length > 1 && (
            <div className="flex items-center justify-between gap-2 mt-3 min-w-0">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-200 disabled:opacity-30 active:scale-95 transition-all">← Prev</button>
              <div className="flex-1 min-w-0 flex items-center justify-center gap-1 overflow-hidden">
                {(() => {
                  const MAX_DOTS = 7;
                  const total = pages.length;
                  if (total <= MAX_DOTS) {
                    return pages.map((_, i) => (
                      <div key={i} className={`h-1 rounded-full transition-all shrink-0 ${i === page ? 'w-4 bg-white' : 'w-1 bg-zinc-700'}`} />
                    ));
                  }
                  let start = page - Math.floor(MAX_DOTS / 2);
                  start = Math.max(0, Math.min(start, total - MAX_DOTS));
                  const end = start + MAX_DOTS;
                  return Array.from({ length: end - start }, (_, k) => {
                    const i = start + k;
                    return <div key={i} className={`h-1 rounded-full transition-all shrink-0 ${i === page ? 'w-4 bg-white' : 'w-1 bg-zinc-700'}`} />;
                  });
                })()}
              </div>
              <button onClick={() => setPage(p => Math.min(pages.length - 1, p + 1))} disabled={page === pages.length - 1} className="shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-200 disabled:opacity-30 active:scale-95 transition-all">Next →</button>
            </div>
          )}
          <p className="text-center text-[10px] text-zinc-600 mt-2">Swipe for upcoming / last 3 days</p>
        </div>
      )}
    </div>
  );
};
