# 02 — Architecture

## Stack

- **Frontend:** React 19, TypeScript, Vite 7, Tailwind CSS 4, Framer Motion,
  lucide-react + @tabler/icons-react
- **Backend:** Vercel serverless functions (`api/`) + Supabase (Postgres, Auth,
  Realtime, Storage)
- **External:** cTrader Open API (OAuth + WebSocket), NVIDIA NIM (AI chat),
  OpenAI Whisper (`/api/transcribe`), TradingView embeds, Finnhub/FMP proxies
- **Testing:** Vitest + @testing-library/react
- **Package manager:** npm

## Folder map

```
api/                     Vercel serverless functions (ESM — see gotchas)
  _lib/                  Shared server helpers (auth, cors, rateLimit, ctraderHarvester)
  candles/               GET shared candles · POST harvest endpoint
  ctrader/               OAuth callback + accounts listing
  economic-calendar.ts   ForexFactory proxy
  nvidia.ts              AI chat proxy
  transcribe/            Voice-note transcription
components/              All UI. Big views at root; subfolders for analytics/, backtest/, ui/, log-trade/, ai/
hooks/                   useAuth, useData (central data layer), useConnectionMode, useLocalStorage…
lib/                     Pure logic: trade-normalization, trade-calculations, bridgeBalance,
                         statsUtils, demoData, constants, timeUtils, supabase client…
services/                Network clients: ctraderService (WS protocol), dataService (Supabase CRUD),
                         authService, nvidiaAiService, openaiService
docs/, project-docs/     Documentation (project-docs/ is canonical)
supabase/migrations/     SQL schema history
scripts/                 Python: MT5 bridge scripts, ForexFactory scraper
test/                    Vitest suites
```

## Data flow

```
MT5 terminal ──(EA)──► localhost:8888 ──┐
                                        ├─► Supabase (ea_sessions) ──Realtime──► App
cTrader ──(WebSocket OAuth)─────────────┘
CSV file ──(parse in browser)───────────────► dataService.addTrade ──► Supabase trades table
Manual entry ──(Log Trade form)─────────────► same

Supabase trades/notes/bias/cash ──Realtime──► useData() state ──props──► views
```

### Central data layer: `hooks/useData.ts`

Owns all user-domain state: `trades`, `notes`, `dailyBias`, `cashTransactions`,
`eaSession`, `lastKnownBridgeBalance` (timestamped), `isBridgeOnline`,
`editingTrade`, `offlineQueue`. Loads from Supabase on auth; subscribes to
Realtime channels per table; polls the local bridge every 5s when connected.

### State composition in `App.tsx`

App overlays demo data when `isDemoMode`:
```ts
activeUserProfile = isDemoMode ? getDemoProfile(userProfile) : userProfile;
activeTrades      = isDemoMode ? demoTrades : trades;
activeNotes       = isDemoMode ? demoNotes : notes;
activeDailyBias   = isDemoMode ? demoDailyBias : dailyBias;
activeEaSession   = isDemoMode ? demoEASession : eaSession;
```
Every mutation handler calls `blockDemoAction()` first when in demo.
All views receive `*={activeX}` props only — they never read raw state.

## Trade normalization pipeline

`lib/trade-normalization.ts → normalizeTrade(trade, fallback?, options?)`

- Coerces every field to safe types (`toFiniteNumber`, etc.)
- Asset type inference from symbol (`detectAssetType`)
- Direction normalized to 'Long' | 'Short'
- PnL: explicit value preserved by default (`preserveProvidedPnl !== false`);
  otherwise recalculated via `calculatePnL` (pip-based for Forex, contract
  multiplier for metals/indices/crypto)
- Result derived from PnL sign unless explicitly set ('Win'/'Loss'/'BE'/'Pending')
- PnL sign force-synced with result

**Rule of thumb:** any code path creating/editing a Trade MUST pass through
`normalizeTrade`.

## Serverless (Vercel) constraints — critical gotchas

1. `"type": "module"` in package.json → functions compile as native ESM.
   **Relative imports inside `api/` MUST use explicit `.js` extensions**
   (`from './_lib/cors.js'`). Extensionless imports crash at runtime with
   FUNCTION_INVOCATION_FAILED even though tsc passes locally.
2. Hobby plan caps serverless functions at **12** — check `api/` count before adding endpoints.
3. Hobby crons are **daily-only**; the candle harvest is pinged externally
   every 15 min instead (see 04/06 docs).
4. The `ws` package needs `"includeFiles": "node_modules/ws/**"` in vercel.json
   or the bundler's require shim crashes the function.
5. Dynamic `import()` inside vite.config.mjs middleware handlers crashes
   ("Vite module runner has been closed") — hoist to top-level await imports.

## Local dev server quirks

- `npm run dev` does NOT execute Vercel functions. `vite.config.mjs` contains
  hand-written middleware mirroring key `/api/*` routes (candles read/harvest,
  ctrader debug-session).
- Dev port is **3000**.
- `.env.local` holds local secrets; Vercel env vars hold production ones.
  They must be kept in sync manually (see 06).

## Auth flow

Supabase email/password auth. `useAuth` bootstraps session on mount, exposes
`handleOnboardingComplete` (writes profile row), `handleUpdateProfile`,
`handleLogout`. Onboarding (`components/Onboarding.tsx`) is a 6-step wizard;
final step offers "Get Started" or "Explore with Demo Data".

## Routing / navigation

Single-page view switcher — no router library. `currentView` string state in
App; sidebar sets it; each view conditionally rendered. Deep links do not exist.
