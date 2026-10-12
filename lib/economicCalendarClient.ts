import { apiUrl } from './capacitor';

export type EconomicCalendarItem = {
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

type FetchCalendarOptions = {
  from?: string;
  to?: string;
  tz?: string;
};

const FF_CDN_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const MEM_TTL_MS = 10 * 60 * 1000; // fresh cache
const STALE_TTL_MS = 60 * 60 * 1000; // stale usable when rate-limited
const MIN_CDN_INTERVAL_MS = 30_000;
const STORAGE_KEY = 'jfx_econ_calendar_cache_v1';

type MemCache = { data: EconomicCalendarItem[]; source: string; at: number };
let memCache: MemCache | null = null;
let inflight: Promise<{ data: EconomicCalendarItem[]; source: string }> | null = null;
let lastCdnAt = 0;

try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) memCache = JSON.parse(raw);
} catch { /* ignore */ }

const persistCache = (c: MemCache) => {
  memCache = c;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(c)); } catch { /* ignore */ }
};

const isFresh = (c: MemCache | null) => !!c && Date.now() - c.at < MEM_TTL_MS;
const isStaleUsable = (c: MemCache | null) => !!c && Date.now() - c.at < STALE_TTL_MS;

const fetchWithTimeout = async (url: string, ms = 12000, init?: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res;
  } finally {
    window.clearTimeout(timer);
  }
};

const normalizeFaireconomy = (raw: unknown): EconomicCalendarItem[] => {
  if (!Array.isArray(raw)) return [];
  const out: EconomicCalendarItem[] = [];
  for (const item of raw as any[]) {
    try {
      const d = new Date(item?.date);
      if (Number.isNaN(d.getTime())) continue;
      const iso = d.toISOString();
      out.push({
        event: item?.title || '',
        currency: item?.country || '',
        date: iso.split('T')[0],
        time: iso.split('T')[1].slice(0, 8),
        impact: String(item?.impact || 'Low').toLowerCase(),
        forecast: item?.forecast || '',
        previous: item?.previous || '',
        actual: item?.actual || '',
        source: 'forexfactory-cdn',
      });
    } catch {
      // skip malformed row
    }
  }
  return out;
};

export const toLocalDateStr = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const getTodayStr = (): string => toLocalDateStr(new Date());

/**
 * Calendar window: today first, max 3 days back, 7 days ahead.
 * Fetch covers [today-3, today+7]; display defaults to [today, today+7].
 */
export const getCalendarWindow = (base: Date = new Date()): { from: string; to: string; today: string } => {
  const today = toLocalDateStr(base);
  const fromD = new Date(base);
  fromD.setDate(base.getDate() - 3);
  const toD = new Date(base);
  toD.setDate(base.getDate() + 7);
  return { from: toLocalDateStr(fromD), to: toLocalDateStr(toD), today };
};

const filterByRange = (events: EconomicCalendarItem[], from?: string, to?: string) => {
  if (!from && !to) return events;
  return events.filter((e) => {
    if (!e?.date) return false;
    if (from && e.date < from) return false;
    if (to && e.date > to) return false;
    return true;
  });
};

/**
 * Fetch the economic calendar in a way that works on both web and the
 * native Capacitor shell (APK).
 *
 * Web: relative `/api/...` works because Vercel serves the function from the
 * same origin.
 * Native (APK): there is no local backend — `https://localhost/api/...` 404s.
 * So we first try the hosted API via `apiUrl()` (https://jfxjournal.site),
 * then fall back to the public ForexFactory CDN directly from the device.
 */
export const fetchEconomicCalendar = async (
  options: FetchCalendarOptions = {},
): Promise<{ data: EconomicCalendarItem[]; source: string }> => {
  const { from, to, tz } = options;

  // Dedup concurrent callers + serve fresh memCache immediately without network
  if (inflight) return inflight;
  if (isFresh(memCache)) {
    return { data: filterByRange(memCache!.data, from, to), source: `${memCache!.source} (cache)` };
  }

  const exec = async (): Promise<{ data: EconomicCalendarItem[]; source: string }> => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (tz) params.set('tz', tz);
    const qs = params.toString() ? `?${params.toString()}` : '';

    // 1) Hosted backend (works on web via relative URL, on native via absolute URL)
    // Attach the session JWT when signed in; the endpoint requires auth and
    // the client falls back to direct CDN otherwise.
    try {
      const url = apiUrl(`/api/economic-calendar${qs}`);
      let authHeader: Record<string, string> = {};
      try {
        const { getSessionToken } = await import('./supabase');
        const token = await getSessionToken();
        if (token) authHeader = { Authorization: `Bearer ${token}` };
      } catch {
        /* signed out — fall through to unauthenticated request + CDN fallback */
      }
      const res = await fetchWithTimeout(url, 12000, Object.keys(authHeader).length > 0 ? { headers: authHeader } : undefined);
      const payload = await res.json().catch(() => ({} as any));
      if (res.ok && !payload?.error) {
        const data = Array.isArray(payload?.data)
          ? payload.data
          : Array.isArray(payload)
            ? payload
            : [];
        if (data.length > 0) {
          const out = { data: filterByRange(data, from, to), source: payload?.source || 'ForexFactory CDN' };
          persistCache({ data, source: out.source, at: Date.now() });
          return out;
        }
      } else if (payload?.error) {
        console.warn('[EconomicCalendar] hosted API error:', payload.error);
      } else if (res.status === 429) {
        // Backend rate-limited — use stale cache instead of hammering direct CDN
        if (isStaleUsable(memCache)) {
          console.warn('[EconomicCalendar] hosted 429, serving stale cache');
          return { data: filterByRange(memCache!.data, from, to), source: `${memCache!.source} (stale)` };
        }
      }
    } catch (e) {
      console.warn(
        '[EconomicCalendar] hosted API fetch failed, trying direct CDN:',
        e instanceof Error ? e.message : e,
      );
    }

    // If we still have fresh-ish cache and CDN was just hit, don't hammer it
    if (isStaleUsable(memCache) && Date.now() - lastCdnAt < MIN_CDN_INTERVAL_MS) {
      return { data: filterByRange(memCache!.data, from, to), source: `${memCache!.source} (throttled)` };
    }

    // 2) Direct CDN fallback — throttled + 429-aware
    try {
      lastCdnAt = Date.now();
      const direct = await fetchWithTimeout(FF_CDN_URL, 15000, {
        headers: { Accept: 'application/json' },
      });
      if (direct.status === 429) {
        if (isStaleUsable(memCache)) {
          console.warn('[EconomicCalendar] CDN 429 — serving stale cache');
          return { data: filterByRange(memCache!.data, from, to), source: `${memCache!.source} (stale)` };
        }
        // No cache yet: soft-fail with empty data instead of throwing ERR_FAILED
        console.warn('[EconomicCalendar] CDN rate limited (429), no cache yet — returning empty');
        return { data: [], source: 'ForexFactory CDN (rate-limited)' };
      }
      if (!direct.ok) {
        throw new Error(`HTTP ${direct.status}`);
      }
      const raw = await direct.json();
      const normalized = normalizeFaireconomy(raw);
      if (normalized.length > 0) persistCache({ data: normalized, source: 'ForexFactory CDN (direct)', at: Date.now() });
      const data = filterByRange(normalized, from, to);
      if (data.length === 0 && normalized.length === 0) {
        throw new Error('The economic calendar service did not return data.');
      }
      return { data, source: 'ForexFactory CDN (direct)' };
    } catch (e: any) {
      // Network ERR_FAILED or otherwise — fallback to stale cache if we have it
      if (isStaleUsable(memCache)) {
        console.warn('[EconomicCalendar] CDN fetch failed, serving stale cache:', e?.message || e);
        return { data: filterByRange(memCache!.data, from, to), source: `${memCache!.source} (stale)` };
      }
      throw e;
    }
  };

  inflight = exec();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
};
