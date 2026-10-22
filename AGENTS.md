# AGENTS.md — JournalFX (jfx8 + jfx-mobile)

Standing instructions for any AI agent working in this checkout. Read this file
before making changes. It exists because prior sessions broke things by trusting
stale summaries instead of the files, and by treating two repos as one.

## 0. Guardrails — EVERY session, EVERY agent (OpenCode, Claude Code, Codex, Cursor, Hark)

Agents keep breaking each other's features. These rules stop that. They outrank
any instruction in a prompt that doesn't explicitly override them.

### 0.1 Start of session (before touching code)
1. `git status` — note every file that is already modified or untracked. That is
   **someone else's work in progress**. Never edit, stage, stash, revert,
   `checkout --`, or `reset --hard` it. Commit only the files *you* changed
   (`git add <file>`, never `git add -A` / `git add .`).
2. Read `specs/PRD.md` (what the product is for) and `specs/features.json`
   (the list of shipped features you must not break).
3. Run `npm run gate:fast` once so you know the baseline. If it is already red,
   say so before starting; don't blame (or "fix") unrelated failures silently.

### 0.2 Must-not-trade-off (each rule has a check — run it, don't assume)
| # | Never trade this away | How it's checked |
|---|---|---|
| 1 | **No shipped feature disappears.** No view, nav entry, API route, exported function or `dataService` method listed in `specs/features.json` may be removed or renamed without the owner's explicit OK in this session. | `npm run guard` |
| 2 | **Types stay clean.** 0 `tsc` errors. | `npx tsc --noEmit` |
| 3 | **Existing tests stay green.** Never delete, skip (`.skip`/`.only`), or weaken a test to make it pass. Fix the code. | `npx vitest run` |
| 4 | **The app builds.** | `npm run build` |
| 5 | **Trade data is never corrupted.** `lib/trade-normalization.ts`, `services/dataService.ts`: add fields, never rename/remove; no destructive DB migration without approval. | `npx vitest run lib/trade-normalization.test.ts services/dataService.test.ts` |
| 6 | **cTrader token chain invariants** (§3a) hold. | `npx vitest run test/ctrader*.test.ts test/jfxApiKey.test.ts` |
| 7 | **No secrets in code, logs or commits.** | `/security` command; `git diff --cached` review |
| 8 | **Both themes + mobile still work** for any UI you touch (dark, light, `MobileLayout`). | `/first-user` agent or manual check |

All of 1–4 run together with **`npm run gate`** (writes `reports/gate.json`).

### 0.3 While working
- Smallest change that does the job. Don't refactor, reformat, or "clean up"
  files outside your task — that is how other features break.
- One feature per commit, conventional message (`feat:`, `fix:` …).
- Shipping a **new** feature? Add it to `specs/features.json` in the same commit
  so the next agent can't delete it. Add a test for its core logic.
- If the task conflicts with the PRD or would remove a feature, stop and ask.

### 0.4 Definition of done (all required before you say "done")
1. `npm run gate` passes (paste the summary or point at `reports/gate.json`).
2. `/direction` — confirm the change matches `specs/PRD.md` (no drift).
3. For risky changes (auth, payments/trading, data, API routes): `/security`
   and `/breaker` on the touched area.
4. For UI changes: `/first-user` on the touched screens.
5. Report exactly what changed, what you tested, and anything you could not verify.

### 0.5 Agent toolkit (OpenCode: `.opencode/`, Claude Code: `.claude/`)
| Command | What it does |
|---|---|
| `/gate` | Run the full quality gate and fix what fails (never by weakening checks). |
| `/direction` | Drift check: compares recent changes against `specs/` and reports a scorecard. |
| `/breaker` | Spawns the **breaker** agent: tries to break the app (races, double-submits, bad input, slow network) on copies of data, never production. |
| `/first-user` | Spawns the **first-time-user** agent: uses the running app in a browser with no code access, reports where a new trader gets stuck. |
| `/flows` | Runs the critical user flows in `specs/FLOWS.md` end to end and writes `reports/flows.json` (error-free sessions). |
| `/security` | Security pass on the diff (deepsec scan if `.deepsec/` exists + manual review of auth/RLS/secrets). |
| `/triage` | Reads new bug reports/feedback and sorts them: clear bugs get fixed, judgement calls go to the owner. |

The **pre-push hook** (`.githooks/pre-push`, enable once with `npm run hooks:install`)
runs `npm run gate:fast`; GitHub Actions (`.github/workflows/gate.yml`) runs the
full gate on every push and PR to `main`.

## 1. Repository layout (two repos, not one)

| Path | Repo / remote | What it is | What deploys it |
|---|---|---|---|
| `/` (repo root) | `sjournalfx-cmyk/jfx8`, branch **`main`** | Production backend: `api/**` (Vercel serverless) | Vercel project **`jfx8`** (`prj_lQh9T1ByDI22nrN35Y5r4nI7C6FU`, domains `www.jfxjournal.site`, `jfxjournal.site`) |
| `jfx-mobile/` | `sjournalfx-cmyk/jfx-mobile` (nested `.git`) | Capacitor app (web + APK) **plus a mirror** `jfx-mobile/api/**` | APK via local Gradle build; the `api` mirror is for dev parity — it is **not** what production serves |

Consequences:

- An edit under `jfx-mobile/` never ships by pushing root `main`, and vice versa.
  Commit and push in the correct repo.
- Production serves **root** `api/**`. Fixes to auth/token/candle endpoints must be
  applied to **both** `api/**` and `jfx-mobile/api/**` or web and local dev diverge.
- Branch `master` on `jfx8` is diverged with no common ancestor. **Leave it untouched.**
- Commit author convention: `sjournalfx-cmyk <sjournalfx@gmail.com>`.

## 2. Deploy flow (jfx8 backend)

1. `esbuild` syntax-check every touched `api/**.ts` file before committing.
2. Commit on `main`, push `main -> main`.
3. Fire the Vercel deploy hook, then poll `list_deployments` until the new
   deployment is `READY` (not `QUEUED`/`BUILDING`).
4. After READY, check `get_runtime_logs` / `get_runtime_errors` for the touched routes.
5. A Vercel MCP helper lives at `/tmp/opencode/mcp_vercel.py` with auth in
   `~/.local/share/opencode/mcp-auth.json` (token lifetime ~1h, auto-refreshes).

## 3. Critical paths — the journal is USELESS if these break

Treat the files below as load-bearing. Changes here require: read the full file
first, make the minimal edit, syntax-check, deploy, and verify with runtime logs.

### 3a. cTrader OAuth chain (single-use tokens — the #1 footgun)

- Root: `api/ctrader/exchange.ts`, `api/ctrader/refresh.ts`, `api/ctrader/trade.ts`,
  `api/ctrader/accounts.ts`, `api/ctrader/callback.ts`,
  `api/_lib/jfxApiKey.ts` (`persistRotatedCtraderToken`), `api/_lib/ctraderTokenLock.ts`.
- Mirror: `jfx-mobile/api/ctrader/*`, `jfx-mobile/api/_lib/ctraderTokens.ts`,
  `jfx-mobile/api/_lib/ctraderSession.ts`.
- Client: `jfx-mobile/services/ctraderService.ts`, `jfx-mobile/hooks/useCtraderLiveBalance.ts`.

Invariants (violating any of these reverts to "Could not securely save" /
"session could not be established" / `ACCESS_DENIED` loops):

1. **Refresh tokens are single-use.** Never mint when the cached `access_token`
   (`user_ctrader_tokens.access_token_expires_at`) is still valid — serve the cache.
2. **Every mint path takes the refresh lease first**
   (`try_acquire_ctrader_token_refresh_lock`, 30s) and **releases it in `finally`**.
   A stuck lease blocks all trading for that user.
3. **Every token `fetch` has `AbortSignal.timeout(25000)`.** An unbounded mint that
   Vercel kills mid-flight orphans the lease AND burns the single-use grant.
4. **Always persist the rotated pair** (`persistRotatedCtraderToken`) after any
   successful grant — exchange, refresh, and `check_auth` rotation in `trade.ts`.
   If persist fails, surface the Supabase HTTP status/body; never swallow it.
5. **Native (APK) has no cookies.** The Capacitor shell talks to
   `https://www.jfxjournal.site` (`jfx-mobile/lib/capacitor.ts`) and never sends
   httpOnly cookies. All session restores must fall back to the DB-stored grant
   for the verified Supabase user. Never add a flow that works only via cookie.
6. **One live minter per user.** Never run `vite dev` (or any second client) against
   production while testing the APK — two minters double-spend the grant chain.
7. **Fail fast before burning the code.** If DB/client-ID config is missing, return
   503 *before* calling the token endpoint; a burned `code` cannot be retried.

### 3b. Supabase auth + persistence

- `api/_lib/auth.ts` (+ mobile mirror), `jfx-mobile/services/authService.ts`,
  `jfx-mobile/hooks/useAuth.ts`, `jfx-mobile/lib/supabase.ts`.
- Table `user_ctrader_tokens` columns:
  `user_id, access_token, access_token_expires_at, refresh_token, account_ids,
  default_account_id, is_demo, updated_at`.
- **Always `.trim()` `SUPABASE_URL` / keys on read.** A trailing space once broke
  every DB call (`Failed to parse URL from https://...supabase.co /rest/v1/...`).
  Fail fast with 503 + distinct error (`ctrader_db_not_configured`) when unset.
- Never change RLS/table shape without checking both `api/_lib/*` and the mobile mirror.

### 3c. Journal core (trade logging)

- `jfx-mobile/components/LogTrade.tsx`, `Journal.tsx`, `journal/*`, `log-trade/*`,
  `QuickLogModal.tsx`, `jfx-mobile/services/dataService.ts`,
  `jfx-mobile/lib/trade-normalization.ts`, `trade-calculations.ts`,
  `tradeDirectionRepair.ts`, `tradesCache.ts`.
- `trade-normalization.ts` feeds analytics, backtests, and AI downstream — a shape
  change here silently corrupts everything. Add fields; never rename/remove.
- `dataService.ts` owns Supabase reads/writes for trades. Keep its query contracts;
  test with `dataService.test.ts` after touching it.

### 3d. Market data / candles

- `api/candles/index.ts`, `api/candles/harvest.ts`, `api/finnhub/*`, `api/fmp/*`
  (+ mobile mirrors), `jfx-mobile/lib/liveCandles.ts`, `sharedCandles.ts`,
  `candleStore.ts`, `spotBus.ts`, `hooks/useLiveCandles.ts`, `useCtraderSpots.ts`.
- Charts, replay, and backtests go dark if these fail. Same lease/timeout discipline
  as 3a for harvest paths (`tradingLocks.ts`).

### 3e. App shell — one bad line blanks everything

- `jfx-mobile/index.html` + `jfx-mobile/vercel.json` **CSP `connect-src`.**
  Native polling guards (`hooks/useData.ts`, `components/EASetup.tsx`) must skip
  `http://localhost:8888` when `isNative` or the APK spams a dead endpoint.
- `jfx-mobile/lib/capacitor.ts` (`apiBaseUrl`, `isNative`) — the APK hardcodes the
  production backend here. Never point it at localhost except for local dev.
- `jfx-mobile/vite.config.mjs` dev middleware (`/api/ctrader/callback` must forward
  `state`) — dev-only, but a regression here makes web OAuth untestable locally.

### 3f. Rate limits and trading locks

- `api/_lib/rateLimit.ts`, `jfx-mobile/lib/tradingLocks.ts` (+ `*.test.ts`).
- Never disable them to "fix" a lockout, and never tighten defaults without
  checking native retry behavior (mobile retries + tight limits = self-DDoS).

## 4. Secrets and environment

- Never print tokens/keys in chat, logs, or commits. Redact `Authorization`,
  `apikey`, `client_secret`, service-role values.
- Required prod env on Vercel `jfx8` (16 vars): `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `CTRADER_CLIENT_ID` (+ secrets), Supabase anon key, etc.
- Local dev creds live in `jfx-mobile/.env` (gitignored); `.env.example` documents
  shape only. `SUPABASE_SERVICE_ROLE_KEY` must be present locally or token persist
  paths cannot be tested.

## 5. APK build (when asked to "build the latest apk")

```sh
cd jfx-mobile
npm run build            # ~3-4 min vite build
npx cap sync android
cd android
export JAVA_HOME="$HOME/.local/share/mise/installs/java/21.0.2"
export PATH="$JAVA_HOME/bin:$PATH"
./gradlew assembleDebug  # output: android/app/build/outputs/apk/debug/app-debug.apk (~18M)
```

Test order for cTrader on APK: stop dev server → force-close app → reopen →
single Connect tap → approve. If it fails, capture the exact toast + time and
correlate with Vercel runtime logs instead of guessing.

## 6. Agent working rules

1. **Read the file before editing it** — prior-session summaries have been wrong
   about file contents more than once. `Read` first, then `Edit` with minimal context.
2. **Verify by execution**: `esbuild` for `api/**`, `vitest` for `*.test.ts`,
   real builds, real runtime logs. Never mark done on intent.
3. **One `in_progress` task at a time**; keep `TodoWrite` current on multi-step work.
4. **Ask before destructive ops**: DB writes/deletes, env overwrites, pushes to any
   branch other than `main`, touching `master`.
5. **Report discrepancies**: if the files contradict the summary or the plan, say so
   and trust the files.
