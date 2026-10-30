---
name: jfx-journal
description: Use the JFX Journal and cTrader API to query journal data, analytics, bridge state, and execute live or demo cTrader trades (open, close, modify).
---

# JFX Journal & cTrader Agent Skill

The API key is stored in the `JFX_KEY` environment variable. Never reveal the key, include it in an answer, write it to source control, or put it in a URL.

Base URLs:
- Journal & Analytics API: https://lwlikhjgwazyrahucatl.supabase.co/functions/v1/jfx-api
- cTrader Execution API: https://www.jfxjournal.site/api/ctrader/trade (local dev: http://127.0.0.1:3000/api/ctrader/trade)
- cTrader Candles API: https://www.jfxjournal.site/api/ctrader/candles (GET only)

Environment (.env downloaded from Settings → Developer Tools):
```
JFX_KEY=jfx_pat_...
JFX_BASE=https://lwlikhjgwazyrahucatl.supabase.co/functions/v1/jfx-api
JFX_CTRADER_TRADE_URL=https://www.jfxjournal.site/api/ctrader/trade
JFX_CTRADER_CANDLES_URL=https://www.jfxjournal.site/api/ctrader/candles
```

Auth headers (either works — do not mix a truncated key):
- `X-API-Key: $JFX_KEY` (preferred)
- `Authorization: Bearer $JFX_KEY`

Copy the FULL key (starts with `jfx_pat_`). Do not trim, wrap, or URL-encode it.

---

## 1. Journal & Analytics Requests

- Latest trade: `GET /v1/trades?limit=1`
- Recent trades: `GET /v1/trades?limit=20`
- Trades only open/live now: `GET /v1/trades?status=open` (alias `?is_open=true`; open trades have `exit_price` null)
- Trades only closed: `GET /v1/trades?status=closed`
- Slim response (drop embedded candles): `GET /v1/trades?limit=20&include=candles:false`; projection: `&fields=id,pair,date,entry_price,exit_price,pnl,portfolio_id`
- Portfolio registry (canonical!): `GET /v1/portfolios` — `id`, `name`, linked accounts, trade counts; use these ids for `/v1/locks/:portfolioId`. The response also lists `orphaned` (portfolio ids referenced by trades but not in the registry) and `unassigned` (trades with `portfolio_id` null) so data drift is visible instead of silent
- Trade summary: `GET /v1/analytics/summary`
- Monthly summary: `GET /v1/analytics/summary?from=YYYY-MM-DD&to=YYYY-MM-DD`
- Notes: `GET /v1/notes?limit=20`
- Bridge health: `GET /v1/bridge/status`. A fresh state answers within `stale: false`; when `stale: true` treat the row as historical, not live — the bridge has not pushed for hours, or ever (`stale_reason`)
- Open positions (MT5 bridge): `GET /v1/positions` — requires `bridge:read` (or `trades:read`/`trades:write` also accepted)
- Me: `GET /v1/me` — requires `me:read`

Scopes: `trades:read` for reads, `trades:write` for journal writes and cTrader execution. `trades:write` implies `trades:read` for both journal and cTrader. Optional scopes: `account:read` (balance/equity), `calendar:read` (economic calendar), `checklists:read`/`checklists:write` (strategy checklists), `locks:read`/`locks:write` (trading locks) — each `:write` implies its `:read`. If you see `403 insufficient_scope`, the key lacks the required scope — scopes cannot be added to an existing key, so tell the user to create a new one with the right scopes checked in Settings → Developer Tools.

---

## 1b. Economic Calendar (requires `calendar:read`)

- This week: `GET /v1/calendar`
- Date range: `GET /v1/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD`
- Response: `{ data: [{ event, currency, date, time, impact, forecast, previous, actual }] }` — `impact` is `High`/`Medium`/`Low`/`Holiday`; `actual` is `null` until the event is released.

```bash
curl -sS -H "X-API-Key: $JFX_KEY" "$JFX_BASE/v1/calendar"
```

---

## 1c. Checklists (requires `checklists:read` / `checklists:write`)

The user's strategy checklists. Template shape:
`{ id, name, isActive, createdAt, updatedAt, items: [{ id, text, phase }] }` — `phase` is `pre-entry`, `in-trade` or `post-trade`.

- List all templates: `GET /v1/checklists`
- One template: `GET /v1/checklists/:templateId`
- Replace all templates: `PUT /v1/checklists` with `{ "templates": [...] }`
- Create a template: `POST /v1/checklists` with `{ "name": "...", "items": [...] }`
- Rename / activate: `PATCH /v1/checklists/:templateId` with `{ "name": "...", "isActive": true }`
- Delete a template: `DELETE /v1/checklists/:templateId`
- Add an item: `POST /v1/checklists/:templateId/items` with `{ "text": "...", "phase": "pre-entry" }`
- Edit an item: `PATCH /v1/checklists/:templateId/items/:itemId` with `{ "text": "...", "phase": "in-trade" }`
- Delete an item: `DELETE /v1/checklists/:templateId/items/:itemId`

```bash
curl -sS -H "X-API-Key: $JFX_KEY" "$JFX_BASE/v1/checklists"
```

---

## 1d. Trading Locks (requires `locks:read` / `locks:write`)

Per-portfolio hard limits: allowed pairs, max trades/day and lot-size range.
Semantics (same as the app): tightening a live rule applies immediately; loosening a live rule is QUEUED for 24h (`pendingChange`); switching a rule off starts a 24h cooling countdown — the rule keeps enforcing until it elapses.

- List every portfolio's locks: `GET /v1/locks`
- One portfolio: `GET /v1/locks/:portfolioId`
- Write rules: `PUT /v1/locks/:portfolioId` with any of `pairWhitelist`, `maxTrades`, `lotGuard`
- Remove all locks: `DELETE /v1/locks/:portfolioId` (returns `409 unlock_in_progress` while a cooling countdown is running)

```json
{
  "pairWhitelist": { "enabled": true, "symbolIds": [12345, 12346] },
  "maxTrades": { "enabled": true, "maxPerDay": 2 },
  "lotGuard": { "enabled": true, "minLots": 0.01, "maxLots": 0.5 }
}
```

Each rule accepts `enabled: false` to request an unlock (24h cooling) — the response shows `unlockRequestedAt` and `cooldownMsRemaining`. A queued loosening shows up as `pendingChange: { value, requestedAt }`; it binds 24h after `requestedAt`. When trading, `locked_by_rule` responses already tell you which rule fired, so prefer reading `GET /v1/locks` once instead of polling `get_portfolios`.

```bash
curl -sS -X PUT -H "X-API-Key: $JFX_KEY" -H "Content-Type: application/json" \
  -d '{"maxTrades":{"enabled":true,"maxPerDay":2}}' \
  "$JFX_BASE/v1/locks/PORTFOLIO_ID"
```

---

## 2. cTrader Live Trading (Open, Close, Modify)

Endpoint: `POST https://www.jfxjournal.site/api/ctrader/trade` (local dev: `POST http://127.0.0.1:3000/api/ctrader/trade`)
Auth: `X-API-Key: $JFX_KEY` (or `Authorization: Bearer $JFX_KEY`). No broker access tokens needed — the server mints cTrader tokens from the stored OAuth grant.
Always include header: `Content-Type: application/json`.

Scopes: any trade execution (`open`, `close`, `modify_position`, `modify_order`, `cancel_order`) requires `trades:write`. Reading positions, accounts, or auth status requires `trades:read` (or `trades:write`).

### Multi-Account & Multi-Broker Support
Users often have multiple cTrader accounts across different brokers (e.g. Fusion Markets, IC Markets, Pepperstone) and account types (Demo vs. Live):
1. **Default Account (Automatic)**: If you omit `ctidTraderAccountId`, the server automatically routes trades to the user's active default account.
2. **Target Specific Account**: Pass `"ctidTraderAccountId": <number>` in the payload to trade on a specific broker account.
3. **Demo vs. Live**: Set `"isDemo": true` for Demo servers (`demo.ctraderapi.com`) or `"isDemo": false` for Live servers (`live.ctraderapi.com`). Omission defaults to Demo for safety.

---

### Recommended Agent Workflow

#### Step 1: Healthcheck & Active Account Check (Zero-Risk)
Always verify the key and inspect the active account before placing trades:
```bash
curl -sS -H "X-API-Key: $JFX_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"check_auth"}' \
  "${JFX_CTRADER_TRADE_URL:-https://www.jfxjournal.site/api/ctrader/trade}"
```
Returns: `{"ok": true, "accountId": 47876400, "isDemo": true, "userId": "..."}`

#### Step 2: List All Available Accounts (Multi-Account Discovery)
If the user specifies a specific broker or account, query all linked accounts first:
```bash
curl -sS -H "X-API-Key: $JFX_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"get_accounts"}' \
  "${JFX_CTRADER_TRADE_URL:-https://www.jfxjournal.site/api/ctrader/trade}"
```
Returns:
```json
{
  "ok": true,
  "defaultAccountId": 47876400,
  "accounts": [
    { "accountId": 47876400, "traderLogin": 10124027, "broker": "Fusion Markets", "isLive": false, "isDemo": true },
    { "accountId": 38291044, "traderLogin": 5018291, "broker": "IC Markets", "isLive": true, "isDemo": false }
  ]
}
```

#### Step 3: Get Open Positions & Pending Orders
```bash
curl -sS -H "X-API-Key: $JFX_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"get_positions","isDemo":true}' \
  "${JFX_CTRADER_TRADE_URL:-https://www.jfxjournal.site/api/ctrader/trade}"
```
Response quality: `symbol` is the resolved broker name (raw symbolIds are translated via `SYMBOLS_LIST`; the full `symbolNames` map is echoed in the response). `currentPrice` is a live mid from the broker quote feed. `profit` is the broker-deposited value; when the feed hasn't supplied one yet it is a labelled estimate — `profitEstimated: true` + `profitCurrency` (quote currency), so convert or mark it as approximate.

#### Step 4: Open Market, Limit, or Stop Order
- `symbol` (aliases: `pair`, `instrument`, `ticker`): `EURUSD`, `GBPUSD`, `XAUUSD`, `BTCUSD`. Broker suffixes like `EURUSD.pro` or `EURUSDm` are automatically matched.
- `volume` / `volumeLots`: standard lots (e.g. `0.01` = 1 micro lot = 1,000 units).
- `side`: `"buy"` or `"sell"`.
- `orderType`: `"market"` (default), `"limit"`, `"stop"`.

```json
{
  "action": "open",
  "symbol": "EURUSD",
  "side": "buy",
  "volumeLots": 0.01,
  "orderType": "market",
  "stopLoss": 1.0750,
  "takeProfit": 1.0950,
  "isDemo": true,
  "ctidTraderAccountId": 47876400,
  "comment": "Opened by AI agent"
}
```

```bash
curl -sS -H "X-API-Key: $JFX_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"open","symbol":"EURUSD","side":"buy","volumeLots":0.01,"orderType":"market","isDemo":true}' \
  "${JFX_CTRADER_TRADE_URL:-https://www.jfxjournal.site/api/ctrader/trade}"
```

#### Step 5: Close Position (Full or Partial)
```json
{
  "action": "close",
  "positionId": 41352173,
  "volumeLots": 0.01,
  "isDemo": true
}
```

#### Step 6: Modify Position (Stop Loss & Take Profit)
```json
{
  "action": "modify_position",
  "positionId": 41352173,
  "stopLoss": 1.0760,
  "takeProfit": 1.0960,
  "isDemo": true
}
```

### Modify / Cancel Pending Order
```json
{
  "action": "modify_order",
  "orderId": 456789,
  "limitPrice": 1.0820,
  "stopLoss": 1.0760,
  "takeProfit": 1.0960,
  "isDemo": true
}
```
```json
{
  "action": "cancel_order",
  "orderId": 456789,
  "isDemo": true
}
```

Only execute trading actions when explicitly requested or confirmed by the user.

## 2a. Account Balance & Equity (requires `account:read`)

```bash
curl -sS -H "X-API-Key: $JFX_KEY" -H "Content-Type: application/json" \
  -d '{"action":"account_summary"}' \
  "${JFX_CTRADER_TRADE_URL:-https://www.jfxjournal.site/api/ctrader/trade}"
```

Reads the connected cTrader account: `{ balance, equity, margin, depositAssetId, swapFree, traderLogin, broker }` (amounts in the deposit currency). Pass `ctidTraderAccountId`/`isDemo` to target a specific account; otherwise the user's default account is used.

## 2b. cTrader Live Candles (OHLC) — GET only

Fetch broker trendbars for chart/replay context; requires `trades:read`:

```bash
curl -sS -H "X-API-Key: $JFX_KEY" \
  "$JFX_CTRADER_CANDLES_URL?symbol=EURUSD&timeframe=H1&count=100"
```

- Params: `symbol` (e.g. `EURUSD`) **or `symbolId`** (the raw id `get_positions` returns — both accepted; name wins when both are sent), `timeframe` (`M1 M5 M15 M30 H1 H4 D1 W1 MN1`, default `H1`), `count` (default 500, max 5000), optional `from`/`to` (unix ms), `ctidTraderAccountId`, `isDemo` (default true).
- A `POST` returns `405 { error: "Method not allowed" }` — this endpoint is GET-only by design.
- Units: all bar values are **real price units already scaled by 10^digits** (`digits: 3` for USDJPY → bars read `157.217`, never `157217`); `unit: "price"` is echoed. `openPrice`/`currentPrice` from positions use the same units — never mix scales.
- Feed quirk: right after a period boundary the first fetch may be empty; the server retries once (`first_fetch_returned_no_bars_retried_ok`). A persistent `no_bars_for_window` means no data in that window.

---

## 3. Response behavior

Parse the JSON response and answer from the returned data. Never invent missing trades or metrics. Explain these responses plainly:

- `401 missing_api_key / malformed_token / invalid_token / expired_token` → key missing, truncated, revoked, or expired. Ask the user to press **Test connection** in Settings → Developer Tools, then recreate the key if needed.
- `403 insufficient_scope` → key lacks required scope (`trades:write` for buy/sell; `account:read`, `calendar:read`, `checklists:read`/`write`, `locks:read`/`write` for the discipline endpoints). Scopes can't be added to an existing key — tell the user to create a new one with the right scopes.
- `409 unlock_in_progress` → a trading-lock rule is in its 24h cooling countdown (`unlock_available_at` is in the response). Wait it out or tighten the rule instead.
- `409 locked_by_rule` → the portfolio's trading locks blocked this order. The response names the rule, the portfolio and the context (allowed pairs, daily limit, lot range). Do not retry — tell the user which rule fired and what is allowed.
- `400 ctrader_not_connected` → key ok, but cTrader not linked. Ask user to connect cTrader on the Connect & Import page.
- `400 no_account_on_host` → the account id is not on the demo/live host this request targeted. Call `get_accounts` first, pass a matching id, or flip `isDemo`.
- `400 no_live_account_connected` → the request used `isDemo: false` but the user has no live cTrader account connected; ask them to connect a live account on the Connect cTrader page, or retry with `isDemo: true`.
- `502 ctrader_auth_failed` → stored cTrader grant expired/revoked. Ask user to reconnect cTrader on the Connect & Import page, then retry.
- `404`: the requested resource does not exist
- `429 rate_limited` → retry after the indicated delay. `503 rate_limiter_unavailable` means the server limiter is down — retry shortly, do not recreate the key.

When the user asks "What was my last trade?", call `GET /v1/trades?limit=1`, inspect the returned record, and summarize the pair, direction, entry/exit, result, P&L, and date when available.
