# Shared Candle Store (service cTrader account)

The Backtest Lab can load charts **without each user connecting their own
cTrader account**. A server-side harvester uses ONE dedicated cTrader account
(the "service account") to pull trendbar history for every symbol and publish
it to a shared Supabase table that all users read.

## How it works

```
Browser (Backtest Lab)
  1. localStorage cache (lib/candleStore.ts)          — instant reloads
  2. GET /api/candles?symbol&timeframe&since          — shared Supabase store
  3. personal cTrader WebSocket (existing flow)       — fallback only
Server
  POST /api/candles/harvest  (Vercel cron, every 15 min)
    → mints access token from CTRADER_SERVICE_REFRESH_TOKEN
    → app auth + account auth over wss://*.ctraderapi.com
    → processes a bounded batch of the harvest_queue table
    → upserts newest 2000 bars per (symbol, timeframe) into candle_series
```

## One-time setup

1. Apply the migration `supabase/migrations/20260824_add_candle_series.sql`
   to your Supabase project (`supabase db push` or dashboard SQL editor).
2. Connect your dedicated (demo recommended) cTrader account through the
   normal OAuth flow once and copy the refresh token (visible in the dev
   response body of `/api/ctrader/exchange`, or mint one manually).
3. Set these Vercel env vars:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - `CTRADER_CLIENT_ID`, `CTRADER_CLIENT_SECRET` (already required)
   - `CTRADER_SERVICE_REFRESH_TOKEN` — service account refresh token
   - `CTRADER_SERVICE_ACCOUNT_ID` — its ctidTraderAccountId
   - `CTRADER_SERVICE_IS_DEMO` — `true` (default) or `false`
   - Optional: `HARVEST_SECRET`, `HARVEST_TIMEFRAMES` (default M15,H1,H4,D1),
     `HARVEST_BATCH_SIZE` (default 5)
4. Deploy — the cron in `vercel.json` starts draining the queue automatically.
   Check progress with:
   `select status, count(*) from harvest_queue group by 1;`

## Rollback

All changes live on branch `experiment/shared-candle-store`. The old behavior
is untouched on `main`; revert by checking out main.
