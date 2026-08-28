# Demo Mode Audit: Fixes, Cleanups & Improvements Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Fix real bugs in demo mode, remove misleading/dead elements, and add small high-value improvements so a first-time user's demo experience is honest, safe, and obvious.

**Architecture:** No architectural change. Demo mode already swaps data arrays at App level (`activeTrades/activeNotes/activeDailyBias/activeEaSession`) and blocks mutations with `blockDemoAction`. This plan patches gaps found in audit: a profile-write leak, an offline-queue leak, dead demo props, weak discoverability of the toggle, stale dates in the dataset, and missing demo badges in some views.

**Tech Stack:** React/TS only. No new dependencies.

---

## Current context (verified in repo)

- `DEMO_MODE_SPEC.md` is the product spec; implementation largely follows it.
- `App.tsx` owns `isDemoMode` (localStorage `jfx_demo_mode`), auto-enables it for onboarded users with zero trades (line ~403), shows a top banner (lines 1005–1036) and guards 14 mutation handlers via `blockDemoAction`.
- `lib/demoData.ts`: 18 trades across Jan–Mar 2026, plus `demoNotes`, `demoDailyBias`, `demoEASession`, `getDemoProfile()`.
- Toggle lives ONLY on the Sidebar avatar button (`Sidebar.tsx:237–250`, title tooltip "Enter/Exit demo mode") — no label, easy to miss.
- Onboarding has NO demo entry point; spec suggests one.
- **BUG (data leak):** `getDemoProfile()` sets `eaConnected: true, syncKey: 'real-sync-key'`. `hooks/useData.ts:124` fetches EA session by syncKey when `eaConnected && syncKey` — using the REAL user profile (useData runs on `userProfile`, not the demo one), so this specific value doesn't hit another account, but if a real user's actual syncKey were ever copied into demo data or vice versa the swap pattern becomes dangerous. More importantly `eaConnected: true` makes UI show "connected" state that isn't real.
- **BUG (write leak):** `EASetup.tsx` has no demo awareness. In demo mode its BridgeMonitor can call `onTradeAdded` → `setTrades(prev => [...])` in App.tsx:1194 — which writes to the REAL `trades` state array (not `activeTrades`), polluting the user's journal after exiting demo. Also `onAddOffline={addToOfflineQueue}` queues to the REAL offline queue which later syncs to Supabase. Both must be blocked in demo mode.
- **BUG (offline leak):** `handleAddTrade` (App.tsx:442) checks demo first — good — but the network-error fallback at line ~500 calls `addToOfflineQueue(trade)` without a demo check. Unreachable today because demo returns earlier, but fragile; guard belongs inside `addToOfflineQueue` itself.
- **Dead prop:** `Journal.tsx` receives `isDemoMode` but never disables its edit/delete/bulk actions — it relies on App-level toasts. Buttons remain clickable and fail with toasts. Works but feels broken; better to hide row action buttons in demo.
- **Stale badge logic:** `Dashboard.tsx:515` uses `!isDemoMode && date === today` for "today" ring; fine. But Dashboard bias widget still cycles bias then toasts — acceptable per read-only spec.
- **Copy drift:** banner says "January to March" — correct while dataset stays 2026 Jan–Mar. Current date Aug 2026 means demo data is 5+ months old; analytics "this month" widgets show 0 trades in demo, which looks broken. Consider regenerating dates relative to "now" OR documenting the static window. Spec says deterministic Jan–Mar; keep static but note the tradeoff.
- `lib/fmpDataTools.ts` / `finnhubDataTools.ts` + their tests are orphaned after slash-command removal — separate cleanup, out of scope here unless trivial.

## Proposed approach

Seven small tasks: two real bug fixes (EASetup write-leak, addToOfflineQueue guard), one honesty fix (demo profile shouldn't claim EA connected), discoverability improvements (labeled demo pill in sidebar, "Try Demo" exit ramp on onboarding completion path), Journal row-action hiding in demo, Analytics demo badge for consistency, and dataset freshness handling (shift demo window to most recent completed Jan–Mar at module load — still deterministic).

## Step-by-step plan

### Task 1: Block demo writes in EASetup + offline queue

**Objective:** Close the two leaks where demo actions could reach real state/Supabase.

**Files:**
- Modify: `App.tsx:1188-1210` (EASetup render block)
- Modify: `hooks/useData.ts:26-34` (`addToOfflineQueue`)

**Steps:**
1. In App.tsx EASetup JSX, change the callbacks:
```tsx
onTradeAdded={(newTrade) => {
  if (isDemoMode) { blockDemoAction('Cannot save trade'); return; }
  setTrades(prev => [newTrade, ...prev]);
}}
```
and
```tsx
onAddOffline={(trade) => {
  if (isDemoMode) { blockDemoAction('Cannot queue trade'); return; }
  addToOfflineQueue(trade);
}}
```
2. In useData.ts `addToOfflineQueue`, add a defensive early return:
```ts
const addToOfflineQueue = (trade: Trade) => {
  // Demo mode must never touch the real offline sync queue.
  const demo = localStorage.getItem('jfx_demo_mode') === 'true' || undefined;
  if (localStorage.getItem('jfx_demo_mode') === 'true') return;
  setOfflineQueue(prev => [...prev, trade]);
  ...
```
(Simpler: accept the localStorage check as shown — hook has no access to isDemoMode state. Keep the existing toast lines after the guard.)
3. Verify: `npx tsc -p tsconfig.json --noEmit` → no new errors (ignore pre-existing trade-normalization).
4. Commit: `fix(demo): block EA trade additions and offline queueing in demo mode`

### Task 2: Make demo profile honest about connection state

**Objective:** Demo profile should not claim a live EA bridge connection.

**Files:**
- Modify: `lib/demoData.ts:617-644` (`getDemoProfile`)

**Steps:**
1. Change returned fields:
```ts
    syncMethod: baseProfile?.syncMethod || 'MANUAL',
    syncKey: 'demo-no-sync',
    eaConnected: false,
    autoJournal: false,
```
Keep plan as-is (PRO) since Analytics/AI features should be sample-visible.
2. Check `Dashboard.tsx` "EA Setup Prompt (For new EA users)" block (~line 779): confirm it keys off `userProfile.eaConnected` from `activeUserProfile` — with `eaConnected:false` the prompt will now show in demo, which is WRONG for a preview. Add `{!isDemoMode && (...)}` around that prompt block (locate via search_files "EA Setup Prompt" in Dashboard.tsx).
3. Typecheck + commit: `fix(demo): demo profile no longer claims live EA connection`

### Task 3: Regenerate demo dates relative to current date

**Objective:** Sample data always spans the most recent ~3 months so analytics look alive.

**Files:**
- Modify: `lib/demoData.ts` (top of file + all date fields)

**Steps:**
1. Add a date-shift helper at the top of `lib/demoData.ts`:
```ts
// Demo dataset anchor: shift the fixed Jan–Mar template so it always ends
// ~2 weeks before "today". Deterministic within a given day.
const ANCHOR_YEAR = 2026;
function shiftedDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const anchor = new Date(Date.UTC(ANCHOR_YEAR, m - 1, d));
  const now = new Date();
  // Most recent March 31 that is >= 30 days ago
  let end = new Date(Date.UTC(now.getUTCFullYear(), 2, 31)); // Mar 31 this year
  end = new Date(end.getTime() - 0); 
  if (end.getTime() > now.getTime() - 30 * 86400000) {
    end = new Date(Date.UTC(now.getUTCFullYear() - 1, 2, 31));
  }
  const offsetDays = Math.round((end.getTime() - Date.UTC(ANCHOR_YEAR, 2, 31)) / 86400000);
  return new Date(anchor.getTime() + offsetDays * 86400000).toISOString().split('T')[0];
}
```
2. Replace every literal `date: '2026-MM-DD'` with `date: shiftedDate('2026-MM-DD')` (18 trades). Same for `openTime`/`closeTime` ISO prefixes and `demoDailyBias`/`demoNotes`/`demoEASession.last_updated` dates — write a codemod-style pass or do sed for `'2026-` → `shiftedDate('2026-` + closing quote handling. Simplest reliable approach: keep raw strings in a `_RAW` table and map once:
   - Rename nothing; instead wrap each usage: `date: shiftedDate('2026-01-05')` etc.
3. Banner copy in `App.tsx:1013` changes from "January to March" to "a recent three-month sample":
```tsx
<p ...>You are viewing a sample journal covering a recent three-month period.</p>
```
Same reword in `Dashboard.tsx:769` ("Sample journal loaded...") — drop the month names, and `Journal.tsx:1307`.
4. Note: `psychologyInsights.ts` scope key already separates demo/live caches — no change.
5. Typecheck + commit: `improve(demo): keep sample data window recent via date shifting`

### Task 4: Hide destructive row actions in Journal during demo

**Objective:** Demo rows shouldn't offer edit/delete buttons that just error-toast.

**Files:**
- Modify: `components/Journal.tsx:~738` (edit button) and bulk-delete toolbar (~588, ~1310-1330)

**Steps:**
1. Wrap the per-row edit button (`onClick={() => onEditTrade(trade)}` at line ~738) in `{!isDemoMode && (...)}` — read surrounding JSX to find exact button bounds.
2. In the selection toolbar (line ~1310+), hide delete/link buttons when `isDemoMode`; simplest: `{!isDemoMode && selectedIds.length > 0 ? (...) : selectedIds.length > 0 && (<span>...</span>)}` — or simply clear `selectedIds` and skip rendering checkboxes: add `{!isDemoMode && (` around checkbox cell; search for checkbox input near line 700s.
3. Commit: `polish(demo): hide edit/delete affordances in Journal during demo`

### Task 5: Make the demo toggle discoverable

**Objective:** Users should see how to enter/exit demo without hovering the avatar.

**Files:**
- Modify: `components/Sidebar.tsx:236-251`

**Steps:**
1. Below the avatar button, add a tiny labeled pill visible when sidebar expanded:
```tsx
<div className="mt-1 flex justify-center">
  <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest cursor-pointer ${isDemoMode ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30' : 'text-zinc-500 hover:text-zinc-300'}`}
    onClick={() => onToggleDemoMode?.()}>
    {isDemoMode ? 'Exit Demo' : 'Try Demo'}
  </span>
</div>
```
(Wrap avatar+pill in a column flex container.)
2. Commit: `polish(demo): visible Try Demo / Exit Demo pill under sidebar avatar`

### Task 6: Onboarding "explore with demo data" exit

**Objective:** First-time users get the spec's suggested entry point.

**Files:**
- Modify: `components/Onboarding.tsx:498-519` (footer buttons)
- Modify: `components/Onboarding.tsx:7-10` (props)
- Modify: `App.tsx:963-967` (onComplete handler)

**Steps:**
1. Extend props: `onExploreDemo?: () => void;`
2. Next to "Get Started" (step 6 branch), add secondary button:
```tsx
<button
  onClick={() => onExploreDemo?.()}
  className={`flex items-center gap-2 px-6 py-4 rounded-xl font-bold text-sm border transition-all ${isDarkMode ? 'border-zinc-700 text-zinc-300 hover:border-zinc-500' : 'border-slate-300 text-slate-600 hover:border-slate-400'}`}
>
  Explore with Demo Data
</button>
```
3. In App.tsx Onboarding render, pass:
```tsx
onExploreDemo={async () => {
  await handleOnboardingComplete({ ...userProfilePlaceholder } as any); // see note
}}
```
NOTE: handleOnboardingComplete requires a full UserProfile; simplest correct wiring: call `await handleOnboardingComplete(profile)` is NOT possible (no profile yet). Instead: set a flag `pendingDemoOnboarding=true` stored in localStorage (`jfx_demo_mode='true'` BEFORE completing), i.e.:
```tsx
onExploreDemo={() => {
  localStorage.setItem('jfx_demo_mode', 'true');
  setIsDemoMode(true);
  // Complete onboarding with minimal profile so app renders; demo profile overlays it anyway.
  void handleOnboardingComplete({
    name: 'Demo Trader', country: '', accountName: 'Sample Account',
    initialBalance: 12500, currency: 'USD', currencySymbol: '$',
    syncMethod: 'MANUAL', experienceLevel: 'Beginner', tradingStyle: 'Day Trader',
    onboarded: true, plan: 'FREE', eaConnected: false,
  } as any).then(() => setCurrentView('dashboard'));
}}
```
(Verify `handleOnboardingComplete` signature in hooks/useAuth.ts accepts partial; adjust to satisfy TS by constructing a complete UserProfile object matching types.ts.)
4. Confirm auto-enable effect (App.tsx:403-408) won't fight: it only sets demo when `storedDemo === null`; we explicitly wrote 'true', fine.
5. Manual test: fresh browser → complete onboarding via Explore Demo → lands on dashboard in demo with banner.
6. Commit: `feat(demo): 'Explore with Demo Data' option on onboarding final step`

### Task 7: Consistency badges + cleanup

**Objective:** Every view communicates demo state; remove leftovers.

**Files:**
- Modify: `components/Analytics.tsx` (add optional `isDemoMode` prop + header badge mirroring Journal's)
- Modify: `App.tsx:1135` (pass `isDemoMode={isDemoMode}`)
- Check `components/Notes.tsx` already toasts on demo mutations (it does, lines ~124/200/218) — leave as toasts (notes list is shared view; acceptable).
- Remove `DEMO_MODE_SPEC.md`? No — keep as historical spec, but append one line at top: `Status: IMPLEMENTED 2026-08 — see docs/shared-candle-store* for unrelated feature docs.` (optional; skip if noise)

**Steps:**
1. Analytics: locate header title block; add same amber badge pattern used in Journal.tsx:1300-1304 conditioned on new prop.
2. Typecheck + commit: `polish(demo): demo badge in Analytics header`

### Task 8: Full verification

**Objective:** Prove nothing regressed.

**Steps:**
1. `npx tsc -p tsconfig.json --noEmit` → clean except pre-existing trade-normalization warning.
2. `npm run test` → all green.
3. `npm run build` → success.
4. Manual QA script (dev server):
   - Fresh localStorage → onboarding → "Explore with Demo Data" → dashboard in demo, banner visible, sample trades present.
   - Dashboard: bias widget clicks → toast, no state change. EA prompt hidden.
   - Journal: no edit/delete buttons on rows; badge visible.
   - Analytics: badge visible; charts populated with recent-window data.
   - Log Trade nav click → redirected to dashboard with toast.
   - Exit Demo via sidebar pill AND via banner button → real empty journal, no demo leakage.
   - AI Chat unaffected.
5. Push and verify production deploy; repeat incognito smoke test on jfxjournal.site.

## Files likely to change

- `App.tsx` (EASetup guards, onboarding wiring, banner copy)
- `hooks/useData.ts` (offline queue guard)
- `lib/demoData.ts` (profile honesty + date shifting)
- `components/Sidebar.tsx` (demo pill)
- `components/Journal.tsx` (hide row actions)
- `components/Dashboard.tsx` (hide EA prompt in demo)
- `components/Analytics.tsx` (badge + prop)
- `components/Onboarding.tsx` (Explore Demo button)

## Tests / validation

Per-task tsc gates; final `npm run lint`, `npm run test`, `npm run build`; manual QA script in Task 8. No new unit tests required (UI wiring), though a small unit test for `shiftedDate()` determinism could be added in `test/demoData.test.ts` if desired (assert same-day stability and end-of-window rule).

## Risks / tradeoffs / open questions

1. **Date shifting vs "deterministic" spec:** spec demanded stable Jan–Mar data. Shifting keeps values stable *per day* but changes across days. Tradeoff accepted: a stale-feeling demo is worse than day-scoped determinism. Flag to user.
2. **Onboarding demo profile persistence:** writing a synthetic profile via `handleOnboardingComplete` creates a real DB profile row named "Demo Trader". When the user later exits demo they'll see that profile name. Mitigation: on Explore-Demo path, set `name` to the empty-string default they'd have typed anyway, or ask user during onboarding step 1 first (the demo button appears on final step AFTER name/account steps, so real formData IS available — better: pass the actual `formData` collected so far instead of synthetic values; recommended).
3. **getDemoProfile syncMethod change** ('EA_CONNECT'→'MANUAL') may alter which views render; verify Backtest Lab/AI unaffected (they don't gate on syncMethod).
4. **Offline-queue localStorage check** bypasses React state (string compare) — acceptable single-source-of-truth compromise; document in code comment.
