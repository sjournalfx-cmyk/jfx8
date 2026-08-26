# 06 — Setup & Deployment

## Local setup

**Prerequisites:** Node 18+, npm, a Supabase project, API keys (NVIDIA for AI
chat, OpenAI for transcription; cTrader app credentials for OAuth).

```bash
npm install
npm run dev        # http://localhost:3000  (NOT default 5173)
```

### `.env.local`

| Key | Purpose |
|---|---|
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Frontend Supabase client |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Serverless functions (service role — never commit) |
| `CTRADER_CLIENT_ID` / `CTRADER_CLIENT_SECRET` | cTrader OAuth app |
| `CTRADER_SERVICE_ACCOUNT_ID` | Shared candle store service acct (`47876400`) |
| `HARVEST_SECRET` | Protects POST `/api/candles/harvest` |

Note: serverless functions read NON-prefixed names; the frontend reads
`VITE_*`. Both sets must exist locally and on Vercel.

### Database

Apply migrations in `supabase/migrations/` via the Supabase dashboard SQL
editor (oldest first). Key tables: profiles, trades, notes, daily_bias,
cash_transactions, ea_sessions, plus the shared candle store trio
(`candle_series`, `harvest_queue`, `service_config`).

## Commands

```bash
npm run dev      # Vite dev server + API middleware on :3000
npm run test     # Vitest suite
npx tsc -p tsconfig.json --noEmit          # typecheck
npm run build    # production build (also verifies)
```

Pre-existing known tsc warning in `lib/trade-normalization.ts` may appear —
not a regression.

## Deployment workflow (GitHub → Vercel)

Repo: `sjournalfx-cmyk/jfx8` (PUBLIC — Vercel Hobby blocks private repos with
non-owner commit authors). Git identity must be
`sjournalfx-cmyk <sjournalfx@gmail.com>`:

```bash
git config user.name "sjournalfx-cmyk"
git config user.email "sjournalfx@gmail.com"

git add -A && git commit -m "feat: ..." 
git push origin main        # auto-deploys to Production
```

Commit author MUST be the project owner or Vercel rejects the deployment.

### Vercel env vars (Production)

Same set as `.env.local` minus `VITE_` duplication concerns — set:
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CTRADER_CLIENT_ID`,
`CTRADER_CLIENT_SECRET`, `CTRADER_SERVICE_ACCOUNT_ID=47876400`,
`HARVEST_SECRET`. Do NOT set `CTRADER_SERVICE_REFRESH_TOKEN` in production —
the live token lives in Supabase `service_config` and rotates itself.

Changing env vars requires a **redeploy** to take effect. CLI shortcut:
```bash
printf '<value>' | vercel env add NAME production   # then redeploy
vercel ls            # confirm Ready
```

### Hobby-plan constraints that shaped the architecture

- Max **12 serverless functions** — count `api/**/*.ts` before adding.
- Crons **daily-only** → external pinger (cron-job.org, free) hits the
  harvest endpoint every 15 min with the secret header.
- ESM functions need explicit `.js` relative-import extensions (see 02).
- `ws` package needs `"includeFiles"` in vercel.json (already configured).

## Troubleshooting

| Symptom | Cause → Fix |
|---|---|
| FUNCTION_INVOCATION_FAILED on one endpoint | Missing `.js` extension in an api import, or new function pushing past 12 — check Vercel build logs |
| Deployment blocked "commit author" | Wrong git identity — see workflow above |
| Env var rejected "invalid characters" | Value pasted into Name field, or stray space/hyphen |
| Harvest returns Unauthorized | Missing/wrong `x-harvest-secret` header vs `HARVEST_SECRET` |
| cTrader ACCESS_DENIED after manual token mint | Token rotated under you — reconnect service account once; harvester re-persists |
| Dev API routes return raw JS source | You hit Vercel functions through Vite — use the middleware routes in vite.config.mjs on port 3000 |
| Charts fail only in prod builds | Check for extensionless relative imports added to `api/` |

## Verification after any deploy

1. Site 200: `curl -o /dev/null -w "%{http_code}" https://www.jfxjournal.site/`
2. Candles read 200: `/api/candles?symbol=EURUSD&timeframe=H1`
3. Harvest rejects anonymous: POST `/api/candles/harvest` → 401
4. Incognito smoke test of core flows (journal, backtest lab chart load)
