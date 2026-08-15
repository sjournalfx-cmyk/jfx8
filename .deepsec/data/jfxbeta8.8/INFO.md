# jfxbeta8.8

## What this codebase does

JFX-JOURNAL is a trading journal web app for forex traders. A React 18 + Vite
SPA (`index.tsx` → `App.tsx`) talks to a Supabase backend (auth, Postgres,
Realtime) and to Vercel serverless API routes under `api/`. Features: trade
logging, journal/analytics (recharts), notes with AI writing help, EA bridge
sync (MetaTrader via a local/VPS bridge), and cTrader Open API integration
(OAuth + direct WebSocket for accounts/positions/history). There are also
Python files: VPS bridge scripts and `public/` copies distributed to users.

## Auth shape

- `services/authService.ts` — Supabase email/password sign-in/up wrappers
  (`signIn`, `signUp`, `getCurrentUser`), the client-side gate in App.tsx.
- `api/_lib/auth.ts` — `requireUser(headers)` helper verifying Supabase JWTs
  for serverless proxies (`api/nvidia.ts`, `api/transcribe.ts`,
  `api/modal-research.ts`).
- cTrader OAuth: `api/ctrader/exchange.ts` + `refresh.ts` use an httpOnly
  cookie (`jfx_ctrader_refresh`) and server-only credentials.
- `lib/supabase.ts` — `getSessionToken()` for the proxies; RLS is the real
  per-user boundary for `profiles`/`trades`/`notes`.

## Threat model

- Stolen/abused paid AI proxies (`/api/nvidia`, `/api/modal-research`,
  `/api/transcribe`) — the app is free-tier so proxy abuse costs the owner
  real money (NVIDIA/Modal/OpenAI quotas). Also XSS in a journal app that
  renders user-authored rich text (TipTap) and markdown, and credential
  leakage: the cTrader client secret is bundled via `VITE_CTRADER_CLIENT_SECRET`
  (required by the cTrader web flow) — treat that var as public-ish.
- RLS bypass / data leakage between users is the highest-impact target for
  Supabase-backed data.

## Project-specific patterns to flag

- Fetch calls to the VPS/EA bridge (`EA_BRIDGE_URL`, `VPS_API_URL`) and
  `mt5_headless/` Python code that handles broker credentials — secrets in
  transit/storage here.
- Direct `wss://` WebSocket code in `services/ctraderService.ts` using the
  bundled client secret (`ProtoOAApplicationAuthReq`) — token handling.
- `api/fmp/[[route]].ts` — generic catch-all proxy that forwards any FMP
  request with the server key; check path/param validation.
- Rich-text/markdown rendering paths (`lib/htmlSanitizer.ts`, note editor,
  react-markdown usage) for stored-XSS.
- Offline queue in App.tsx (`offlineQueue`, `addToOfflineQueue`) that
  re-sends operations — check idempotency/authz.

## Known false-positives

- `index.html` CSP allows `'unsafe-inline'`/`'unsafe-eval'` and broad
  `connect-src https: wss: ws:` — intentional for TradingView + cTrader WS;
  flag only concrete bypasses.
- `VITE_CTRADER_CLIENT_SECRET` in the client bundle is by design (cTrader web
  flow requirement), not an accidental leak.
- PostHog key in App.tsx is a public write-only analytics key.
- Landing page files (`components/LandingPage.tsx`,
  `components/PerformanceSequence.tsx`, `components/landing-mock-data.ts`) are
  excluded from this scan — ignore any findings that reference them.
