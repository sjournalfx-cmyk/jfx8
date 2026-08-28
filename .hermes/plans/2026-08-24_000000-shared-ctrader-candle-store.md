# Shared Candle Data Service (No Per-User cTrader Connect for Backtest Lab) — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Let Backtest Lab users load candlestick charts without connecting their own cTrader account, by having the app itself harvest and publish candle history for all pairs into a shared cloud store (Supabase) that every user reads.

**Architecture:** A server-side harvester holds ONE operator-owned cTrader "service account" (refresh token stored server-side, never shipped to browsers). It connects to cTrader's WebSocket API, walks every available symbol × timeframe, and upserts trendbar history into a `candle_series` table in Supabase. The browser Backtest Lab reads from this shared store first (new `sharedCandleStore.ts`), falling back to the existing per-user cTrader flow only when the shared series is missing/stale or the user wants live data. Local per-browser caching (`lib/candleStore.ts`) stays exactly as-is on top of whichever source served the bars.

**Tech Stack:** Node/TS serverless (Vercel Functions + a scheduled cron trigger, or Supabase Edge Function with pg_cron), `ws` WebSocket client speaking the same ProtoOA JSON framing already used in `services/ctraderService.ts`, Supabase Postgres + RPC upserts, React frontend unchanged except its data-loading order.

---

## Honest assessment of the idea (asked for)

The idea is good and common in the industry (shared market-data cache), **but one premise needs correcting**: cTrader Open API cannot fetch trendbars with only your OAuth *app* credentials (client id/secret). Every `GET_TRENDBARS_REQ` must ride on an authenticated *account* — `ACCOUNT_AUTH_REQ` requires a user access token bound to a `ctidTraderAccountId`. That is why the app today forces each user to connect.

So "use the credentials we have" works only if we pair them with **one dedicated account that YOU control** (a demo account under your own cTrader profile is ideal):

1. You connect that service account once through the existing OAuth flow.
2. The exchange endpoint saves ITS refresh token server-side as the "service token".
3. From then on, the harvester re-mints access tokens from it forever — no end user ever connects.

Tradeoffs / risks:
- **ToS / rate limits:** harvesting all pairs × timeframes hits cTrader rate limits (roughly 50 reqs/s per connection, and trendbar requests are capped at ~7 days of M1 per request... practically: M1 history for 60+ pairs is thousands of requests). Schedule harvesting incrementally, not in one burst.
- **Symbol coverage differences:** symbol lists are per-broker/per-account. The service account's broker defines what "all pairs" means. Users whose trades reference other brokers' symbol names need the fuzzy matching that already exists in `fetchCtraderCandles` (normalize `/` and `_`).
- **Digits/divisor assumption:** current code divides prices by a fixed 100000. The harvester should use each symbol's `digits` from `SYMBOLS_LIST_RES` (already partially handled via `getCachedSymbolsList`).
- **Vercel function limits:** a full backfill can run minutes-hours. Do the backfill as a resumable queue processed by repeated short cron invocations (each tick processes N symbols then exits), rather than one long-running process.
- **Cost/storage:** M1 bars for many pairs at 2000 bars/series is trivially small in Postgres JSONB (< a few hundred MB even aggressively). Fine.

Verdict: proceed, with a service demo account + incremental cron harvester + Supabase shared store + read-first-then-fallback loading order.

---

## Current context (verified in repo)

- Browser flow today: `components/BacktestLab.tsx:830-946` — checks `isCtraderAuthenticated()`, shows the auth modal if not connected, picks an account, then either tops-up a cached series (`topUpCtraderSeries`) or calls `fetchCtraderCandles(account.ctidTraderAccountId, ...)` → `getTrendbars(...)` over a browser-held WebSocket (`services/ctraderService.ts:1123-1224`).
- Local cache: `lib/candleStore.ts` (localStorage, v2 payloads, LRU, 2000 bars/series) — source-agnostic, reusable unchanged.
- Server side: `api/ctrader/exchange.ts` stores the user's refresh token in an httpOnly cookie (`jfx_ctrader_refresh`); `api/ctrader/refresh.ts` mints access tokens. Both read env vars `CTRADER_CLIENT_ID` / `CTRADER_CLIENT_SECRET`.
- Cloud DB: Supabase is used via edge functions (`supabase/functions/*`) and migrations live in `supabase/migrations/`.
- Existing tests: `test/candleStore.test.ts`, `test/ctraderService.test.ts`; verify with `npm run test`, `npm run lint`, `npm run build`.

## Proposed approach

1. New Supabase table `candle_series` keyed `(symbol, timeframe)` storing a capped JSONB bar array + `last_bar_time` + `updated_at`, world-readable (SELECT for `anon`), writable only by the `service_role` key.
2. New server module `api/_lib/ctraderHarvester.ts` (Node): logs the service account in from a server-stored refresh token, performs app+account auth over a Node `ws` socket, lists symbols once, and processes harvest jobs from a queue table.
3. New endpoints: `POST /api/candles/harvest` (cron-invoked, processes a bounded batch) and `GET /api/candles?symbol=&timeframe=` (public read proxy so the browser never needs Supabase keys beyond what it already has; alternatively read directly via supabase-js anon key — decide in Task 2).
4. One-time bootstrap endpoint/page: `GET /api/candles/service-session` admin flow that captures the service account's refresh token during a single manual OAuth grant and persists it server-side (env var `CTRADER_SERVICE_REFRESH_TOKEN` is acceptable for v1 — simplest and safest).
5. Frontend: new `lib/sharedCandles.ts` fetch helper + reorder loading in `BacktestLab.tsx` so the chain becomes: local cache → shared store top-up/full load → (only if missing/stale AND user connected) personal cTrader fetch. Remove the hard "must be connected" gate when the shared store can serve the request.

---

## Step-by-step plan

### Task 1: Supabase migration for `candle_series`

**Objective:** Create the shared, publicly-readable candle store.

**Files:**
- Create: `supabase/migrations/20260824_add_candle_series.sql`

**Steps:**
Write SQL:

```sql
create table if not exists public.candle_series (
  symbol        text not null,
  timeframe     text not null,
  bars          jsonb not null default '[]'::jsonb,
  bar_count     int  not null default 0,
  last_bar_time bigint not null default 0,   -- unix seconds of newest bar
  digits        int  not null default 5,
  updated_at    timestamptz not null default now(),
  primary key (symbol, timeframe)
);

alter table public.candle_series enable row level security;

drop policy if exists "public read candle_series" on public.candle_series;
create policy "public read candle_series"
  on public.candle_series for select
  to anon, authenticated
  using (true);
-- No insert/update policy: only the service_role key (server-side) may write.

create index if not exists candle_series_updated_idx on public.candle_series (updated_at desc);
```

Run `supabase db push` locally (or apply via dashboard) and verify with a SELECT.

### Task 2: Decide read path and add public GET endpoint

**Objective:** Browsers can read a shared series without any cTrader connection.

**Files:**
- Create: `api/candles/index.ts`
- Modify: `.env.example` (document `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` usage server-side)

**Step 1:** Implement `api/candles/index.ts` as a Vercel function mirroring the style of `api/ctrader/refresh.ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// GET /api/candles?symbol=EURUSD&timeframe=H1&since=<unixSeconds>
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const symbol = String(req.query.symbol || '').toUpperCase().replace(/[/_]/g, '');
  const timeframe = String(req.query.timeframe || '').toUpperCase();
  const since = Number(req.query.since || 0);
  if (!symbol || !timeframe) return res.status(400).json({ error: 'symbol and timeframe are required' });

  const supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || ''
  );
  let query = supabase
    .from('candle_series')
    .select('symbol,timeframe,bars,bar_count,last_bar_time,digits,updated_at')
    .eq('symbol', symbol)
    .eq('timeframe', timeframe)
    .limit(1);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  const row = data?.[0];
  if (!row) return res.status(404).json({ error: 'not_found' });

  // Client can ask for only bars newer than what it already has.
  const bars = Array.isArray(row.bars) ? row.bars.filter((b: any) => !since || b.time > since) : [];
  return res.status(200).json({ ...row, bars });
}
```

**Step 2:** Confirm `@supabase/supabase-js` is in `package.json` dependencies (add if absent).

**Verification:** `curl "http://localhost:3000/api/candles?symbol=EURUSD&timeframe=H1"` → expect `404 {"error":"not_found"}` until Task 5 populates data (that proves routing + DB wiring work).

### Task 3: Server-side harvester library

**Objective:** Reusable Node module that authenticates the SERVICE account and pulls trendbars — no browser involved.

**Files:**
- Create: `api/_lib/ctraderHarvester.ts`
- Test: `test/ctraderHarvester.test.ts`

Key design (port of browser logic in `services/ctraderService.ts`, minus localStorage):
- Use `ws` package (`npm i ws @types/ws` — check it isn't already present first).
- `PT` payload-type constants: copy from `services/ctraderService.ts:201-254` into a shared `api/_lib/protoTypes.ts` so browser and server never drift (DRY).
- Auth chain per connection: `APPLICATION_AUTH_REQ(clientId, clientSecret)` → `ACCOUNT_AUTH_REQ(ctidTraderAccountId, accessToken)` where accessToken is minted from the service refresh token via the same POST to `https://openapi.ctrader.com/apps/token` used in `api/ctrader/refresh.ts`.
- Export:

```ts
export interface HarvestTarget { symbolName: string; symbolId: number; digits: number; }
export async function listSymbols(service: ServiceSession): Promise<HarvestTarget[]>;
export async function fetchTrendbarsServer(
  service: ServiceSession,
  target: HarvestTarget,
  period: number,             // reuse mapTimeframeToCtraderPeriod values (duplicate tiny map here)
  opts: { fromTimestamp?: number; toTimestamp?: number; count?: number }
): Promise<{ bars: Array<{ time:number; open:number; high:number; low:number; close:number }>; digits: number }>;
```

Bar decoding must replicate `getTrendbars()` math exactly (`low/100000 + delta/100000`, `utcTimestampInMinutes * 60`) but use `digits` per symbol instead of a hardcoded divisor assumption — note in code that cTrader price fields scale by 10^5 regardless of digits; digits only controls display rounding.

**TDD steps:**
1. Write failing unit test for the pure parts: bar decoding from a sample ProtoOAGetTrendbarsRes payload fixture, and symbol-name normalization (EURUSD vs EUR/USD vs EURUSD.a fuzzy match consistent with `fetchCtraderCandles`).
2. Run `npx vitest run test/ctraderHarvester.test.ts` → FAIL (module missing).
3. Implement module until tests pass.
4. Live-network behavior is integration-tested manually in Task 6, not unit-tested.

### Task 4: Harvest endpoint (bounded batch processing)

**Objective:** Cron-callable endpoint that advances a persistent work queue a little at a time.

**Files:**
- Create: `supabase/migrations/20260824_add_harvest_queue.sql` (queue table: `harvest_queue(id, symbol, timeframe, status pending|done|error, attempts, updated_at)`)
- Create: `api/candles/harvest.ts`

Behavior per invocation (must finish well inside Vercel's ~60s limit):
1. Load service refresh token from env `CTRADER_SERVICE_REFRESH_TOKEN`; if unset → 503.
2. Mint access token; open WS; app+account auth (account id also from env `CTRADER_SERVICE_ACCOUNT_ID`).
3. If queue empty: seed it from `listSymbols()` × timeframes `['M15','H1','H4','D1']` (start conservative; M1 later — YAGNI).
4. Claim up to N=5 pending rows (`FOR UPDATE SKIP LOCKED` via an RPC, or simple update-where-status=pending loop given single-worker reality).
5. For each: fetch newest 2000 bars (`count: 2000`, no from/to → server returns most recent window), merge with existing `candle_series.bars` (dedupe by `time`, incoming wins — same semantics as `mergeBars` in `lib/candleStore.ts`; extract nothing shared across bundle boundaries, just duplicate the 8-line merge), cap to newest 2000, upsert row.
6. Mark rows done/error (max 3 attempts), return `{processed, remaining}`.

**Commit:** `feat(candles): shared candle_series store + harvest queue`

### Task 5: Bootstrap the service account (one-time)

**Objective:** Capture YOUR account's refresh token as the service credential.

**Files:**
- Modify: `api/ctrader/callback.ts` — after a successful exchange, ALSO persist tokens when URL contains `?service=1` (link you visit privately once): write refresh token to Supabase `app_config` table (new tiny table) instead of cookie; log nothing sensitive.
- Docs: append setup section to `vps-mt5-setup.md` or create `docs/service-account.md`: steps = open authorize URL with service flag, grant the demo account, done.

Simpler alternative accepted for v1: manually paste the refresh token into Vercel env var `CTRADER_SERVICE_REFRESH_TOKEN` (obtainable by completing the normal OAuth once and copying from the dev response body path that already exists in `exchangeCode`). Plan assumes the manual-env-var route; the callback change is optional polish.

### Task 6: Frontend — read shared store first, drop the hard auth gate

**Objective:** Backtest Lab loads charts with zero cTrader connection whenever the shared store has the series.

**Files:**
- Create: `lib/sharedCandles.ts`
- Modify: `components/BacktestLab.tsx:820-946` (the fetch orchestration block)
- Test: extend existing component-level test if present, else rely on `npm run test` + manual QA

**Step 1 — `lib/sharedCandles.ts`:**

```ts
import { Candle } from '../types';

const norm = (s: string) => s.toUpperCase().replace(/[/_]/g, '');

/** Fetch shared series; returns null when the store doesn't have it yet. */
export async function fetchSharedCandles(symbol: string, timeframe: string, since?: number): Promise<Candle[] | null> {
  try {
    const url = `/api/candles?symbol=${encodeURIComponent(norm(symbol))}&timeframe=${encodeURIComponent(timeframe)}${since ? `&since=${since}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data.bars) || data.bars.length === 0) return null;
    return data.bars;
  } catch {
    return null;
  }
}

export async function fetchSharedLastBarTime(symbol: string, timeframe: string): Promise<number | null> { /* HEAD-ish variant reading meta only */ return null; }
```

**Step 2 — reorder logic in BacktestLab's loader (around line 830):**

Replace the early-return auth gate with:
1. Try local cache top-up + shared-store top-up (`fetchSharedCandles(sym, tf, lastLocalTime)`), merge, render. This succeeds for anonymous users.
2. Only if shared store returns nothing usable AND the user IS connected → existing personal-cTrader path (keep all current code intact as the fallback branch).
3. If neither source has data and user is NOT connected → toast explaining "Shared history not harvested yet for X TF — connect cTrader or check back", still showing cached/local data. No modal forced.

Keep `saveToLocalCache(candles, activeSymbol, activeTF)` call so `lib/candleStore.ts` continues to serve instant reloads regardless of origin. Set `setDataSource('shared')` when the shared store contributed bars (update the small source badge if one exists).

**Step 3 — background backfill hooks:** replace/augment `backfillCtraderTimeframes(activeSymbol)` (line ~945) so after a chart loads it also primes sibling timeframes from the shared store (cheap GETs) before ever touching the user's cTrader socket.

**Manual QA checklist:**
- Fresh browser profile, never connected: open Backtest Lab → pick EURUSD H1 → chart renders from shared store, no auth modal.
- Connected user: behaviour identical to today for pairs the harvester hasn't reached (personal fetch still works).
- Timeframe switching feels instant (local + shared caches).

### Task 7: Scheduling the harvester

**Objective:** Keep shared series fresh without human action.

- Add `vercel.json` cron entry (check existing file first): e.g. `"crons": [{ "path": "/api/candles/harvest", "schedule": "*/15 * * * *" }]` — each tick processes a batch; full universe refreshes within hours. Adjust cadence after observing runtime/rate-limit behavior.
- Verify: watch `harvest_queue` drain across ticks; `select count(*), max(updated_at) from candle_series;`.

### Task 8: Cleanup + docs

- Update README/docs with the architecture diagram (browser → local cache → shared store → personal cTrader fallback).
- Ensure no secrets reach the client bundle: grep for `SERVICE_REFRESH` in anything imported by `src`/frontend entry.
- Run `npm run test && npm run lint && npm run build` — all green.
- Final commit(s): conventional commits per task.

---

## Files likely to change (summary)

- Create: `supabase/migrations/20260824_add_candle_series.sql`, `20260824_add_harvest_queue.sql`
- Create: `api/candles/index.ts`, `api/candles/harvest.ts`, `api/_lib/ctraderHarvester.ts`, `api/_lib/protoTypes.ts`, `lib/sharedCandles.ts`, `docs/service-account.md`
- Modify: `components/BacktestLab.tsx` (loading order + gate removal only — no replay/drawing logic touched), possibly `vercel.json`, `package.json` (+`ws`)
- Untouched: `lib/candleStore.ts`, `services/ctraderService.ts` (personal fallback keeps working as-is)

## Tests / validation

- Unit: bar decoding fixtures, symbol normalization, merge semantics (`test/ctraderHarvester.test.ts`).
- Integration: curl the GET endpoint (404 → 200 after harvest); harvest endpoint twice → second pass reports `remaining` decreasing.
- E2E manual: disconnected browser loads charts; connected-user regression unchanged.
- Gates: `npm run test`, `npm run lint`, `npm run build`.

## Risks, tradeoffs, open questions

1. **You must supply one real cTrader account** (demo recommended) to act as the service account — app credentials alone are insufficient. This is the main decision point; everything else follows.
2. Rate limits during initial backfill → mitigated by bounded batches + retries; consider starting with majors-only before "all pairs".
3. Broker-specific symbol universes: users trading other brokers may hit unmatched symbols → falls back to their own connection (already preserved).
4. Fixed 100000 price divisor assumption inherited from current code — validate against the service account's actual symbol metadata during Task 6 QA (JPY pairs especially).
5. Vercel cron granularity (paid plans allow finer schedules); alternative is Supabase pg_cron calling an edge function.
6. Open question: should M1 be harvested at all initially (storage fine, request volume high)? Default plan says start M15/H1/H4/D1.
