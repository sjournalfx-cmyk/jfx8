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
api/candles/harvest  (POST) ── seeds queue: symbols × M15/H1/H4/D1 (~640 series)
        │ batches of 15, newest-2000 bars per series
        ▼
Supabase candle_series (PK symbol+timeframe, bars jsonb, public-read RLS)
        │
        ▼
api/candles (GET ?symbol=&timeframe=&since=) ◄── Backtest Lab / any user, no login needed
```

Freshness: cron-job.org pings the harvest endpoint every 15 min with an
`x-harvest-secret` header (Vercel Hobby crons are daily-only). Vercel's own
cron runs daily at 03:00 UTC as backstop.

## Where everything lives

| Thing | Location |
|---|---|
| Service account id | Vercel env `CTRADER_SERVICE_ACCOUNT_ID=47876400` |
| App credentials | Vercel env `CTRADER_CLIENT_ID` / `CTRADER_CLIENT_SECRET` |
| Live refresh token | Supabase `service_config` table, key `ctrader_service_refresh_token` — auto-rotates |
| Harvest auth | Vercel env `HARVEST_SECRET`; callers send `x-harvest-secret` header |
| Harvester core | `api/_lib/ctraderHarvester.ts` + plain-ESM `harvestCore.js`, `harvesterNet.mjs`, `protoTypes.*` |
| Read endpoint | `api/candles/index.ts`; client helper `lib/sharedCandles.ts` |
| Dev middleware | `vite.config.mjs` mirrors both endpoints locally |

## Critical gotchas

1. **Token rotation:** cTrader invalidates the old refresh token on every
   mint. The harvester MUST persist the rotated token to `service_config`
   (callbacks wired in both TS and ESM paths). NEVER manually mint a test
   token — it burns the stored one.
2. **ESM extensions:** `harvestCore` is imported as `.js` everywhere (Vercel,
   Vite middleware, tests). Do not rename back to `.mjs`.
3. **Batch math:** each harvest call processes ≤15 series; full universe
   ≈640 series. Initial backfill ran locally via a curl loop.
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

**Production harvest (auth'd)**
```bash
curl -X POST https://www.jfxjournal.site/api/candles/harvest \
     -H "x-harvest-secret: $HARVEST_SECRET"
```

**Recovery from ACCESS_DENIED / CH_ACCESS_TOKEN_INVALID**
1. The stored refresh token was burned (manual mint or cTrader-side expiry).
2. Reconnect the service account through the normal cTrader OAuth UI once.
3. Grab the fresh refresh token via dev-only `/api/ctrader/debug-session`
   (dev server only).
4. Update the `service_config` row (or let one successful harvest rotate it).
5. Never paste tokens into chat/logs.

**Adding M1/M5 later:** set `HARVEST_TIMEFRAMES` env var; queue re-seeds on
next harvest. Expect much higher request volume during initial fill.

## Verification checklist (all passed 2026-08-25)

- [x] ~640 series harvested, ≤2000 real bars each
- [x] Public read endpoint serves production traffic (200)
- [x] Harvest rejects unauthenticated calls (401), accepts secret header
- [x] Incognito Backtest Lab loads any pair instantly, zero connection
- [x] Token rotation persists across dev + production runs
