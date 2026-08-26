# 03 — Connections & Data Integrity

How trades and account data enter JournalFX, and the rules that keep
balances, equity, and PnL mathematically correct.

## The three ingestion paths

### 1. Desktop Bridge (MT5)

- Windows EXE (`public/jfx_bridge.py` / GUI) + MQL5 EA streams account data to
  `localhost:8888/api/account` locally AND syncs to Supabase `ea_sessions`.
- App polls localhost every 5s while `userProfile.eaConnected`
  (`hooks/useData.ts`). Each poll: writes timestamped
  `lastKnownBridgeBalance = { v:1, balance, capturedAt }` and merges into
  `eaSession`.
- Bridge heartbeat freshness: `<15s` → `isBridgeOnline = true`
  (same rule as Sidebar indicator).
- Closed trades auto-log through `BridgeMonitor` → `normalizeTrade` →
  `dataService.addTrade` (falls back to offline queue on failure; demo blocks
  both).
- Setup wizard in `components/EASetup.tsx` (`BridgeWizard`) — user pastes a
  sync key; completion sets `syncKey` + `eaConnected: true` on the profile.

### 2. cTrader Open API

- OAuth via cTrader ID; callback hits `api/ctrader/callback.ts`; tokens live
  server-side (httpOnly cookie session) + in-memory access token.
- WebSocket protocol implemented in `services/ctraderService.ts`
  (ProtoOA message types). Demo/live environments are separate sockets.
- `CtraderConnect` UI shows accounts, live balance/equity, positions, closed
  deals (addable to journal), market watch, manual order entry.

**Unit conventions (critical):**
| Field | Raw ProtoOA | After service mapping |
|---|---|---|
| profit/swap/commission | cents | ÷100 → account currency |
| balance/equity/margin (TRADER) | cents | ÷100 (done inside `getTrader()`) |
| volume | units ×10⁷ | ÷10⁷ → lots |
| absolute prices (entry/exit/SL/TP) | integer ticks scaled by symbol `digits` | ÷10^digits via `scalePrice()` with digits map from `getSymbolsList` |

Digits fallback when symbol unknown: JPY-quoted → 3, else 5.

**Direction convention:** `tradeSide === 1 ('buy') → 'Long'`, sell → 'Short'
(fixed 2026-08; previously inverted).

### 3. CSV import

- `lib/trade-import.ts → parseMTTradeCSV(text)` — delimiter-sniffing,
  header-alias resolution, side normalization (/buy|long|bull/ → Long etc.).
- PnL = profit + commission + swap + fees from the file (preserved as-is).
- Entry points: Connect & Import "Import CSV" card and Log Trade import.

## Balance & equity resolution

Single source of truth: **`lib/bridgeBalance.ts`**. All consumers must use it;
never read `eaSession.data.account.balance` directly for display math.

```
resolveBridgeBackedBalance({ userProfile, totalPnL, eaSession,
                             lastKnownBridgeBalance, isBridgeOnline, isDemoMode })
```

Decision order:
1. **Demo mode → always manual** (`initialBalance + totalPnL`). Never leak a
   real bridge snapshot into demo.
2. No authoritative bridge source → manual.
   *Authoritative* means `userProfile.eaConnected` or
   `syncMethod === 'EA_CONNECT'`. A stored snapshot alone does NOT qualify.
3. Online + session has finite balance → **session balance wins**.
4. Offline but connected → fresh stored snapshot wins
   (`{ v:1, balance, capturedAt }`, max age 7 days; legacy bare numbers =
   infinitely stale = ignored).
5. Session balance (even without online flag) next.
6. Fallback manual.

Tier gate (Analytics initial-balance path): only HOBBY/STANDARD plans use
broker-derived balances; FREE always uses configured `initialBalance`.

Consumers: `App.tsx` currentBalance, `Analytics.tsx`
effectiveInitialBalance (equity curve seed), `lib/analyticsAiSnapshot.ts`,
Dashboard equity widget.

## PnL correctness rules

1. Every Trade passes `normalizeTrade`. Explicit PnL preserved by default.
2. Recalculation (`calculatePnL`, `lib/trade-calculations.ts`):
   Forex → pip diff × pipValuePerLot(10, JPY 6.5) × lots;
   other assets → price diff × contract multiplier × lots.
   Direction-aware: Long = exit − entry; Short = entry − exit.
3. Result ↔ PnL sign force-synced after derivation.
4. R:R from `calculateRiskReward({entryPrice, stopLoss, takeProfit, exitPrice, lots, assetType, direction})`.

## Known pitfalls / history (do not regress)

- **cTrader direction was inverted** until 2026-08 (`'sell' ? 'Long'` bug) —
  deals imported before the fix may have flipped directions in the DB.
- **Prices were raw ticks** before digit-scaling was added; old imported rows
  may contain unscaled prices.
- **TRADER payloads are cents** — any new consumer of raw WS TRADER_UPDATE_EVENT
  must ÷100 (the handler in CtraderConnect already does).
- Stale `lastKnownBridgeBalance` used to override journal math forever and
  leaked into demo — fixed via timestamped snapshots + demo early-return.
  Old localStorage values (bare numbers) self-disable.
- Open Positions dashboard widget renders ONLY when `eaConnected` (cached
  ghost sessions otherwise).
- Vercel ESM gotchas apply to all `api/ctrader/*` endpoints (see 02).

## QA matrix for connection work

| Path | Verify |
|---|---|
| Bridge | Balance matches MT5 within seconds; disconnect freezes ≤7d-old value; trade edit recomputes cleanly |
| cTrader | Terminal balance ≈ cTrader app (~$20k not $2M); deal direction matches actual trade; prices look like 1.08xxx not 108245 |
| CSV | Imported PnL totals match file; prices untouched |
| Demo | Dashboard shows demo numbers ($12.5k seed), never real bridge data |
| Cross-account | New userId ⇒ fresh storage namespace; no bleed |
