# Connection Data-Integrity Audit & Fixes Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Verify and fix balance/equity/PnL correctness for all three connection methods (cTrader OAuth, Desktop Bridge, CSV import) so journal numbers are never wrong or double-counted.

**Architecture:** No architectural change. Three fixes plus one guard: (1) correct the inverted cTrader direction mapping that corrupts recalculated PnL/RR, (2) fix cTrader price scaling (raw cTrader prices lack symbol-digit normalization), (3) make the balance resolution tier-aware and demo-safe so broker balance can't silently override or be overridden by journal PnL, (4) block the stale-balance leak where `lastKnownBridgeBalance` from one account bleeds into another after switching.

**Tech Stack:** React/TS only. No new deps.

---

## Current context (verified in repo)

### How balance flows today
- **Single source of truth:** `lib/bridgeBalance.ts`
  - `resolveBridgeBackedBalance()`: if a "bridge source" exists → prefer live `eaSession.data.account.balance`, then `lastKnownBridgeBalance` (localStorage), then session balance, else manual `initialBalance + totalPnL`.
  - `resolveBridgeBackedInitialBalance()` (Analytics): only HOBBY/STANDARD plans use broker-derived initial balance; FREE always manual.
  - `isBridgeBalanceSourceAvailable()`: true if syncMethod==='EA_CONNECT' OR eaConnected OR lastKnownBridgeBalance exists OR session has balance.
- **Desktop Bridge path:** `hooks/useData.ts:331-370` polls `localhost:8888/api/account` every 5s when `eaConnected`; writes `lastKnownBridgeBalance` + merges into `eaSession`. Bridge heartbeat freshness (`<15s`) sets `isBridgeOnline`.
- **cTrader path:** `components/EASetup.tsx` CtraderConnect fetches `getTrader()` per account → displays balance/equity in its own UI ONLY. **It never writes eaSession or lastKnownBridgeBalance** — so cTrader balance does NOT flow into Dashboard/Analytics at all today. That's a gap, not corruption.
- **CSV path:** `lib/trade-import.ts` parses rows; PnL = profit + commission + swap + fees; side normalized to Long/Short.
- **Demo mode:** `App.tsx` swaps in `demoEASession` (has fake balance) — combined with real `lastKnownBridgeBalance` this is a leak vector.

### BUGS FOUND

**BUG 1 (HIGH) — Inverted direction on cTrader deals.**
`EASetup.tsx:1382`: `direction: deal.tradeSide === 'sell' ? 'Long' : 'Short'`. cTrader's tradeSide is already normalized to 'buy'/'sell' strings in `ctraderService.ts:761` (`tradeSide === 1 ? 'buy' : 'sell'`). A SELL close deal means a SHORT position was held... actually per ProtoOA, DEAL side is the EXECUTION side of the deal; for closing deals the side is opposite the position direction. But regardless of interpretation: mapping `'sell' → 'Long'` reads backwards against every other mapper in the codebase (`mt5Trade.type === 'BUY' ? 'Long' : 'Short'` at line 585). Consequence: `normalizeTrade` recalculates RR via `calculateRiskReward({direction})` with flipped direction → wrong R:R displayed on every imported cTrader deal. PnL itself is preserved (explicit pnl passed through), but any user edit that triggers recalculation flips the PnL sign too.

**BUG 2 (HIGH) — cTrader deal prices not digit-normalized.**
`ctraderService.ts:763`: `price: Number(deal.executionPrice ?? deal.price ?? 0)` — raw ProtoOA absolute prices are integers scaled by symbol digits (e.g., EURUSD 108245 = 1.08245 with 5 digits). Profit/swap/commission ARE divided by 100 (lines 764-766) but prices are NOT scaled by 10^digits anywhere. Same for `entryPrice` (line 771) and SL/TP (769-770). So saved trades get entry=108245 instead of 1.08245 → recalculated pip distances are absurd → RR metrics garbage whenever explicit PnL is absent or user re-saves. Fix requires fetching symbol digits (symbols list is already loaded in CtraderConnect as `symbolsList`) and dividing absolute prices by 10^digits at map time.

**BUG 3 (MEDIUM) — Balance source ignores plan/tier and mixes sources across accounts.**
`resolveBridgeBackedBalance`: `isBridgeBalanceSourceAvailable` returns true merely because `lastKnownBridgeBalance` exists in localStorage — even months after disconnect, or after the user switched from bridge account ($5k) to manual entry. Then line 46 returns the STALE stored number forever. Also in demo mode App passes `activeEaSession` (fake $20k+) while `lastKnownBridgeBalance` may hold the REAL bridge value → demo dashboard shows the user's actual private balance. Fixes:
- Store `{balance, capturedAt}` not bare number; ignore if older than e.g. 7 days.
- In demo mode, never use `lastKnownBridgeBalance` (it's keyed by userId, holds real data).
- Only treat bridge/session balance as authoritative when `syncMethod === 'EA_CONNECT' && eaConnected` (bridge users), NOT for MANUAL/BROKER_SYNC users who once polled localhost.

**BUG 4 (LOW) — Dashboard floating PnL shows bridge positions in non-bridge setups.**
`Dashboard.tsx:568-570,688-719`: Open Positions widget renders whenever `eaSession` exists, summing `openPositions.profit`. For a cTrader-only user (no bridge), `eaSession` is null so fine; but a lapsed bridge user with cached localStorage session sees stale positions labeled "Cached". Acceptable UX but should hide when `!userProfile.eaConnected`.

**BUG 5 (INFO) — CSV import trusts file PnL.**
Correct behavior (preserveProvidedPnl defaults true) — no change needed. Note only.

### What's already CORRECT (verified)
- Bridge poll writes balance only when `typeof === 'number'`; heartbeat freshness gate (15s) is sound.
- Analytics equity curve seeds from `effectiveInitialBalance` + journal deltas — internally consistent.
- Demo mode uses `activeEaSession` everywhere consistently.
- CSV normalizeSide covers buy/sell/long/short/bull/bear variants.
- `getSafePnL` guards NaN throughout stats paths.

## Step-by-step plan

### Task 1: Fix cTrader deal direction mapping
**Objective:** Stop flipping Long/Short on cTrader-imported deals.

**Files:**
- Modify: `components/EASetup.tsx:1382`

**Steps:**
1. Change:
```ts
direction: deal.tradeSide === 'buy' ? 'Long' : 'Short',
```
Rationale: `buildDealTrade` consumes closing deals; ProtoOA close deals carry the side of the CLOSING execution which is opposite the holding direction, BUT the existing service normalizes to buy/sell of the deal action. Empirically the codebase convention elsewhere maps buy→Long; aligning removes the guaranteed inversion for the dominant case. (If field-testing shows close-deal inversion, flip to `=== 'sell' ? 'Long'` with a comment — one-line toggle.)
2. `npx tsc -p tsconfig.json --noEmit` → clean.
3. Commit: `fix(ctrader): correct deal direction mapping (buy→Long)`

### Task 2: Digit-normalize cTrader prices
**Objective:** Entry/exit/SL/TP saved as real prices, not raw integer ticks.

**Files:**
- Modify: `services/ctraderService.ts:758-772` (getClosedDeals mapper)
- Modify: `services/ctraderService.ts:989-994` (getTrader — balance/equity ARE /100 already via trader payload? verify: lines show profit/swap/commission ÷100; TRADER.res balance/equity are also cents → confirm `data.trader` consumers divide. EASetup:1723 uses raw payload.trader.balance without ÷100 → check and fix.)

**Steps:**
1. Extend `getClosedDeals` to accept an optional `symbolDigits: Record<number, number>` param OR resolve digits lazily: simplest robust approach — add helper:
```ts
const scalePrice = (raw: unknown, digits: number | undefined): number | undefined => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return digits !== undefined ? n / Math.pow(10, digits) : n;
};
```
2. In CtraderConnect (`EASetup.tsx:1460-1466`) the symbols list is fetched in parallel. Reorder: await `getSymbolsList` FIRST, build `digitsById` map, pass into a new second param of `getClosedDeals(id, from, to, isDemo, digitsById)`; scale `price`, `entryPrice`, `stopLoss`, `takeProfit` by `10^digits(symbolId ?? tradeData.symbolId ?? closePositionDetail.symbolId)`, defaulting digits=5 when symbol unknown (JPY→3 using symbolName heuristic like line 1211).
3. Check TRADER.res units: read ProtoOA response handling near line 992. If `data.trader.balance` arrives in cents (it does per proto spec), divide in `getTrader` before returning: `return { ...data.trader, balance: data.trader.balance / 100, equity: data.trader.equity / 100 }`. Then REMOVE the duplicate `/100` nowhere else applied — audit EASetup:1723 (TRADER_UPDATE_EVENT) to apply `/100` there too, and EASetup:1643 (accounts list enrichment) likewise.
4. Typecheck + commit: `fix(ctrader): scale deal prices by symbol digits; normalize TRADER balance/equity from cents`

### Task 3: Hardened balance resolution
**Objective:** Broker balance only overrides journal math when genuinely connected, fresh, and non-demo.

**Files:**
- Modify: `hooks/useData.ts:18,349` (store timestamped object)
- Modify: `lib/bridgeBalance.ts` (freshness + authority rules)
- Modify: `App.tsx:1003-1010` and `components/Dashboard.tsx` call sites if signature changes (keep backward-compatible)

**Steps:**
1. Migration-safe storage shape: keep key `jfx_last_bridge_balance_${userId}` but store `{ v: 1, balance: number, capturedAt: string }`. On read, accept legacy bare numbers but treat them as stale (>0 days old).
2. In `lib/bridgeBalance.ts`:
```ts
export const BRIDGE_BALANCE_MAX_AGE_MS = 7 * 86400000;

export const parseStoredBridgeBalance = (stored: unknown): { balance: number; ageMs: number } | null => {
  if (stored && typeof stored === 'object') {
    const o = stored as { v?: number; balance?: unknown; capturedAt?: string };
    const bal = typeof o.balance === 'number' && Number.isFinite(o.balance) ? o.balance : NaN;
    if (!Number.isFinite(bal)) return null;
    const t = Date.parse(o.capturedAt || '');
    return { balance: bal, ageMs: Number.isFinite(t) ? Date.now() - t : Infinity };
  }
  const legacy = typeof stored === 'number' ? stored : NaN;
  return Number.isFinite(legacy) ? { balance: legacy, ageMs: Infinity } : null;
};
```
Update `resolveBridgeBackedBalance` options to accept `isDemoMode?: boolean` and add rules at top:
```ts
if (isDemoMode) {
  // Demo must show demo-session data only — never the real bridge snapshot.
  return (userProfile?.initialBalance || 0) + totalPnL;
}
```
and replace `isFiniteNumber(lastKnownBridgeBalance)` checks with parsed+fresh checks; require `userProfile?.syncMethod === 'EA_CONNECT' && userProfile?.eaConnected` for the source-available shortcut (drop bare `lastKnownBridgeBalance` as sufficient condition).
3. Update writers/readers: `useData.ts:349` → `setLastKnownBridgeBalance({ v: 1, balance: accData.account.balance, capturedAt: new Date().toISOString() })`; type the state accordingly.
4. Pass `isDemoMode` from `App.tsx:1003` call and from `Analytics.tsx:317` (add prop threading: App already passes `isDemoMode` to Analytics? It does NOT currently for balance purposes — add `isDemoMode={isDemoMode}` there and extend `buildAnalyticsAiSnapshot` + `resolveBridgeBackedInitialBalance` with the same early-return rule).
5. Typecheck + commit: `fix(balance): freshness-checked, demo-safe, connection-aware broker balance`

### Task 4: Hide stale open-positions widget when not bridge-connected
**Objective:** No ghost positions from cached sessions.

**Files:**
- Modify: `components/Dashboard.tsx:688-719` (widget render condition)

**Steps:**
1. Wrap case body: render widget only when `userProfile.eaConnected`; otherwise render a slim empty-state card ("Connect Desktop Bridge to see live positions") consistent with existing card styles.
2. Typecheck + commit: `polish(dashboard): open positions widget requires active bridge connection`

### Task 5: Verification
**Objective:** Prove all three paths produce correct, isolated numbers.

**Steps:**
1. `npx tsc -p tsconfig.json --noEmit` → clean (except pre-existing warning).
2. `npm run test` → all green.
3. `npm run build` → success.
4. Manual QA matrix (dev server):
   - **Bridge:** connect EA → balance matches MT5 within seconds; disconnect → balance freezes at last synced (not older than 7d); edit a trade → PnL updates, balance recomputes correctly.
   - **cTrader:** connect → terminal balance/equity display matches cTrader app (post-÷100); add closed deal to journal → direction matches actual trade; entry/exit look like real FX prices (1.08xxx not 108245); RR sensible.
   - **CSV:** import sample → PnL sums match file totals; no price mangling.
   - **Demo:** enter demo → dashboard balance shows DEMO values ($12.5k seed + demo PnL), never your real bridge balance; exit → real values return.
   - **Cross-account:** switch syncKey/user → no stale balance bleed (new key = fresh storage namespace).

## Files likely to change

- `components/EASetup.tsx` (direction fix, symbols-first ordering, ÷100 audit)
- `services/ctraderService.ts` (scalePrice helper, getClosedDeals digits param, getTrader cent conversion)
- `hooks/useData.ts` (timestamped balance storage)
- `lib/bridgeBalance.ts` (freshness/demo/authority rules)
- `App.tsx`, `components/Analytics.tsx`, `components/Dashboard.tsx` (prop threading + widget gate)

## Tests / validation

Per-task tsc gates; full suite + build in Task 5; manual QA matrix above covering all three connection paths plus demo isolation. Optional unit test: `test/bridgeBalance.test.ts` covering parseStoredBridgeBalance legacy/fresh/stale/object shapes and demo early-return (fast, pure functions — recommended).

## Risks / tradeoffs / open questions

1. **Close-deal side semantics:** If live testing reveals ProtoOA close deals DO need inverted mapping, it's a one-line toggle in Task 1 — flag for field verification with the user's Fusion Markets demo account.
2. **Digits defaulting:** Deals whose symbolId isn't in the fetched list fall back to 5-digit (JPY-aware via name). Rare; acceptable.
3. **TRADER.res unit confirmation:** Plan assumes cents-per-proto-spec. Verify against live account (balance ~$20k should display 20,000.xx not 2,000,000.00) during QA before removing any existing ÷100.
4. **Legacy localStorage migration:** Bare-number values treated as infinitely old = effectively disabled until next successful bridge sync repopulates. Safe default.
