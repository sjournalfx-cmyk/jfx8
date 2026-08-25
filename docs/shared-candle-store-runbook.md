### Local backfill loop (used for the initial 640-series fill)
```bash
while true; do
  curl -s -X POST http://localhost:3000/api/candles/harvest; echo; sleep 2;
done
```
~5 series/batch locally. Stop when remaining: 0.

### Remove the dev debug endpoint when done
`/api/ctrader/debug-session` exists only in vite.config.mjs (dev middleware).
It prints the refresh token to anyone with a session cookie. Safe on
localhost; it is NOT deployed (Vercel only serves api/*.ts). Delete it from
vite.config.mjs if you want extra hygiene.

## Troubleshooting quick reference

| Symptom | Cause | Fix |
|---|---|---|
| 401 on harvest | missing/wrong x-harvest-secret | compare cron-job.org header vs Vercel env |
| "Service cTrader session not configured" | no token in service_config AND none in env | run OAuth once, update service_config |
| "Token refresh failed" / ACCESS_DENIED | token rotated elsewhere | see recovery above |
| FUNCTION_INVOCATION_FAILED | usually ws bundling or import extensions | check vercel.json includeFiles + .js extensions |
| Chart shows "no data" toast | pair not in candle_series yet | trigger harvest; check queue status for that symbol |
| Timeframe switch slow | local cache empty | first load fetches; afterwards cached |

## Cost / limits reality check
- Vercel Hobby: daily cron only, 12 functions max → external pinger used
- cTrader rate limits: batches of 15 sequential requests are safe; the full
  640-series initial backfill took ~50 min locally without throttling
- Storage: ~640 series x 2000 bars ≈ well under 100 MB in Postgres JSONB

## Future improvement ideas (not yet built)

- M1/M5 timeframes: supported via HARVEST_TIMEFRAMES, but initial backfill
  request volume is high — add selectively
- Incremental top-up optimization: pass fromTimestamp = last_bar_time once
  the store is mature, instead of refetching newest 2000 bars
- "Last updated" indicator on the Shared History chip using updated_at
- Symbol aliasing for other-broker names (EURUSD.a suffixes)
- Admin endpoint to inspect/requeue failed queue items (currently manual SQL)

## Verification checklist (all passed 2026-08-25)

- [x] Local unit tests: 7/7 harvester tests, 164 total project tests
- [x] Local dev middleware: GET returns data, POST harvests
- [x] Initial backfill: 640/640 series harvested, queue empty
- [x] Production read: EURUSD H1 = 2000 bars via jfxjournal.site
- [x] Production harvest: ok:true, token rotation persisted
- [x] Production auth: no secret -> 401
- [x] Incognito browser test: chart loads with zero connections
