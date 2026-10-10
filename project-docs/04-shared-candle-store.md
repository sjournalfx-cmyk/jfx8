# 04 — Shared Candle Store

The Backtest Lab loads charts **without each user connecting their own
cTrader account**. A server-side harvester uses ONE dedicated cTrader account
(the "service account") to pull trendbar history for every symbol and publish
it to a shared Supabase table all users read.

## Architecture

```
cTrader service acct (47876400, Fusion Markets demo)
        │ OAuth refresh-token flow (token ROTATES on every mint)
        ▼
api/candles/harvest  (GET for Vercel cron / POST for external pinger)
        │ seeds queue: symbols × M1/M5/M15/M30/H1/H4/D1 (~1100 series)
        │ batches of 50 (TIME_BUDGET_MS 45s guard), newest-2000 bars per series
        │ (fetches 2100 to absorb broker short-responses)
        ▼
Supabase candle_series (PK symbol+timeframe, bars jsonb, public-read RLS)
        │
        ▼
api/candles (GET ?symbol=&timeframe=&since=) ◄── Backtest Lab / any user, no login needed
```

Freshness: cron-job.org pings the harvest endpoint every 15 min with an
`x-harvest-secret` header (Vercel Hobby crons are daily-only). Vercel's own
cron runs daily at 03:00 UTC as backstop. The endpoint accepts both:
`GET` + `Authorization: Bearer <CRON_SECRET>` (Vercel) and `POST` +
`x-harvest-secret: <HARVEST_SECRET>` (external pinger).

> Cadence truth: ONE tick processes ONE batch (default 50 series, hard max
> 50, plus a 45s time-budget guard that defers leftovers to the next tick).
> With ~1100 rows (7 timeframes), a healthy 15-min pinger drains a full cycle
> in well under a day; the lone daily Vercel tick alone means ~3-week cycles.
> Claims are stalest-first, so every series advances each cycle. If candles
> freeze for weeks, the pinger is almost certainly failing auth (401/405 in
> its logs) — see triage below, not the batch size.

## Where everything lives

| Thing | Location |
|---|---|
| Service account id | Vercel env `CTRADER_SERVICE_ACCOUNT_ID=47876400` |
| App credentials | Vercel env `CTRADER_CLIENT_ID` / `CTRADER_CLIENT_SECRET` |
| Live refresh token | Supabase `service_config` table, key `ctrader_service_refresh_token` — auto-rotates |
| Harvest auth | Vercel env `CRON_SECRET` (Vercel cron, GET+Bearer) and `HARVEST_SECRET` (external pinger, POST+`x-harvest-secret`). Both must be set. |
| Harvester core | `api/_lib/ctraderHarvester.ts` + plain-ESM `harvestCore.js`, `harvesterNet.mjs`, `protoTypes.*` |
| Read endpoint | `api/candles/index.ts`; client helper `lib/sharedCandles.ts` |
| Dev middleware | `vite.config.mjs` mirrors both endpoints locally |

## Critical gotchas

1. **Token rotation:** cTrader invalidates the old refresh token on every
   mint. The harvester MUST persist the rotated token to `service_config`
   (callbacks wired in both TS and ESM paths). NEVER manually mint a test
   token — it burns the stored one. Concurrent ticks also burn each other,
   so the endpoint exits early (before minting) when a run claimed jobs in
   the last 14 minutes — keep the external pinger interval ≥15 min.
2. **ESM extensions:** `harvestCore` is imported as `.js` everywhere (Vercel,
   Vite middleware, tests). Do not rename back to `.mjs`.
3. **Batch math:** each harvest call processes ≤50 series with a 45s time
   budget (leftovers reset to pending for the next tick); full universe
   ≈1100 series across 7 timeframes. Seeding runs every tick, so timeframe
   additions take effect without waiting for a drain.
4. **Overfetch:** harvest requests 2100 bars but stores the newest 2000.
   cTrader intermittently returns one fewer bar than requested (live
   1999-bar rows seen on EURUSD/M15, XAUUSD/H1, …), and since top-ups only
   append newer bars, a short seed would otherwise stick at 1999 forever.
4. **Queue shape:** `harvest_queue` rows keyed symbol+timeframe with
   status/attempts; harvest response:
   `{"ok":true,"processed":N,"remaining":M,"errors":[]}`.

## Operations runbook

**Health check**
```sql
select count(*) as series, sum(bar_count) as total_bars,
       max(updated_at) as newest_update from candle_series;
```

**Manual harvest (local dev)**
```bash
curl -X POST http://localhost:3000/api/candles/harvest
```

**Production harvest (auth'd — either form works)**
```bash
curl https://www.jfxjournal.site/api/candles/harvest \
     -H "Authorization: Bearer $CRON_SECRET"
curl -X POST https://www.jfxjournal.site/api/candles/harvest \
     -H "x-harvest-secret: $HARVEST_SECRET"
```

**Stale-series triage (e.g. last bars weeks old)**
```sql
-- 1. Is the queue draining or stuck?
select status, count(*) from harvest_queue group by 1;
-- 2. Which series are stalest?
select symbol, timeframe, last_bar_time, updated_at from candle_series
 order by updated_at asc limit 20;
-- 3. Dead rows (recovered automatically after 24h since 20260923 migration)
select symbol, timeframe, attempts, updated_at from harvest_queue
 where status = 'error' order by updated_at desc limit 20;
```
Then check: cron-job.org logs for 401/405 (wrong secret/method), Vercel
cron logs for 500s (cTrader token burned — see recovery below), and that
both `CRON_SECRET` and `HARVEST_SECRET` are set in Vercel env.

**Recovery from ACCESS_DENIED / CH_ACCESS_TOKEN_INVALID**
1. The stored refresh token was burned (manual mint or cTrader-side expiry).
2. Reconnect the service account through the normal cTrader OAuth UI once.
3. Grab the fresh refresh token via dev-only `/api/ctrader/debug-session`
   (dev server only).
4. Update the `service_config` row (or let one successful harvest rotate it).
5. Never paste tokens into chat/logs.

**Timeframe coverage:** default `HARVEST_TIMEFRAMES` is
`M1,M5,M15,M30,H1,H4,D1` (Backtest Lab supports the same 7). Depth caveat:
the 2000-bar store cap means M1 covers only ~33h and M5 ~7 days — they stay
fresh for replaying recent sessions, not deep history. Narrow via env var if
queue cycle time matters more than coverage.

## Verification checklist (all passed 2026-08-25)

- [x] ~640 series harvested, ≤2000 real bars each
- [x] Public read endpoint serves production traffic (200)
- [x] Harvest rejects unauthenticated calls (401), accepts secret header
- [x] Incognito Backtest Lab loads any pair instantly, zero connection
- [x] Token rotation persists across dev + production runs
