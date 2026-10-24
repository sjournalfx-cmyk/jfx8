import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCorsHeaders } from './_lib/cors.js';

const FF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
};

// In-memory module cache for serverless instance lifetime
let cachedCalendarEvents: any[] | null = null;
let lastCalendarFetchTime = 0;
const CALENDAR_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

const getSingle = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCorsHeaders(res, req.headers);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const from = getSingle(req.query?.from);
    const to = getSingle(req.query?.to);
    const now = Date.now();

    let allEvents: any[] = [];

    // Use in-memory cache if still fresh
    if (cachedCalendarEvents && (now - lastCalendarFetchTime < CALENDAR_CACHE_TTL)) {
      allEvents = cachedCalendarEvents;
    } else {
      try {
        const upstream = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
          headers: FF_HEADERS,
        });

        if (upstream.ok) {
          const raw = await upstream.json();
          if (Array.isArray(raw)) {
            for (const item of raw) {
              const d = new Date(item.date);
              if (isNaN(d.getTime())) continue;
              allEvents.push({
                event:    item.title    || '',
                currency: item.country  || '',
                date:     d.toISOString().split('T')[0],
                time:     d.toISOString().split('T')[1].slice(0, 8),
                impact:   (item.impact  || 'Low').toLowerCase(),
                forecast: item.forecast || '',
                previous: item.previous || '',
                actual:   item.actual   || '',
                source:   'forexfactory-cdn',
              });
            }

            if (allEvents.length > 0) {
              cachedCalendarEvents = allEvents;
              lastCalendarFetchTime = now;
            }
          }
        }
      } catch (fetchErr: any) {
        console.warn('[EconomicCalendar] CDN fetch warning:', fetchErr.message);
      }

      // If fresh fetch failed or was empty, fall back to stale cache
      if (allEvents.length === 0 && cachedCalendarEvents && cachedCalendarEvents.length > 0) {
        allEvents = cachedCalendarEvents;
      }
    }

    // Filter to requested date range if provided
    let filtered = allEvents;
    if (from || to) {
      const rangeFiltered = allEvents.filter((e: any) => {
        if (!e.date) return false;
        if (from && e.date < from) return false;
        if (to   && e.date > to)   return false;
        return true;
      });
      // If date filter matches events, use them; otherwise return all available weekly events
      if (rangeFiltered.length > 0) {
        filtered = rangeFiltered;
      }
    }

    res.status(200).json({
      data:      filtered,
      source:    'ForexFactory CDN',
      cached:    cachedCalendarEvents ? true : false,
      timestamp: Date.now(),
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch economic calendar data',
    });
  }
}
