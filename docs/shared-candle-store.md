# Shared Candle Store — Complete Reference

> Feature shipped: 2026-08-25. All JournalFX users can load Backtest Lab
> charts WITHOUT connecting a personal cTrader account. Data comes from a
> server-harvested shared store in Supabase.

This directory contains four documents:

1. **shared-candle-store.md** (this file) — what was built and how it works
2. **shared-candle-store-config.md** — credentials, env vars, tables, gotchas
3. **shared-candle-store-runbook.md** — operations, recovery, troubleshooting
4. **shared-candle-store-future.md** — improvement ideas + verification log

## What was built (summary)

A dedicated "service" cTrader account (demo, Fusion Markets #47876400) is
logged in SERVER-SIDE by a harvester. It pulls trendbar history for every
symbol the account can see and publishes up to 2000 bars per series into a
Supabase table. Browsers read that table through a public endpoint — no
personal cTrader connection required.

Chart loading order in Backtest Lab:
1. localStorage cache (`lib/candleStore.ts`) — instant reloads
2. Shared store via `GET /api/candles` — main source for everyone
3. Personal cTrader WebSocket — fallback only (connected users, missing pairs)

The old UI clutter (MT5 bridge chip, cTrader connect modal, JSON import,
"Fetch history" calendar) was removed from BacktestLab and StartScreen.

## Architecture / data flow

```
[cron-job.org every 15 min] ──POST──> /api/candles/harvest (Vercel fn)
                                        │ 1. loads refresh token from
                                        │    Supabase service_config
                                        │ 2. mints short-lived access token
                                        │ 3. opens wss to cTrader
                                        │    app auth + account auth
                                        │ 4. seeds queue if empty (all
                                        │    symbols x M15,H1,H4,D1)
                                        │ 5. processes batch of 15:
                                        │    GET_TRENDBARS -> upsert
                                        ▼
                              Supabase candle_series (public READ)
                              Supabase harvest_queue (no client access)
                                        ▲
[Browser] ──GET /api/candles?symbol&timeframe&since──┘
```

## Key files

| File | Role |
|---|---|
| `supabase/migrations/20260824_add_candle_series.sql` | Tables + RLS |
| `api/_lib/ctraderHarvester.ts` | Production harvester lib (TS) |
| `api/_lib/harvestCore.js` | Pure helpers shared dev+prod |
| `api/_lib/harvesterNet.mjs` | Dev-only copy of network layer |
| `api/_lib/protoTypes.ts` / `.mjs` | ProtoOA payload constants |
| `api/candles/index.ts` | Public GET endpoint |
| `api/candles/harvest.ts` | Cron-driven POST endpoint |
| `lib/sharedCandles.ts` | Browser fetch helper |
| `components/BacktestLab.tsx` | Loading order + shared-first logic |
| `components/backtest/StartScreen.tsx` | Simplified start screen |
| `vite.config.mjs` | Dev middleware mirroring both endpoints |
