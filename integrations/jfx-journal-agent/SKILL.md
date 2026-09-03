---
name: jfx-journal
description: Use the JFX Journal and cTrader API to query journal data, analytics, bridge state, and execute live or demo cTrader trades (open, close, modify).
---

# JFX Journal & cTrader Agent Skill

The API key is stored in the `JFX_KEY` environment variable. Never reveal the key, include it in an answer, write it to source control, or put it in a URL.

Base URLs:
- Journal & Analytics API: https://lwlikhjgwazyrahucatl.supabase.co/functions/v1/jfx-api
- cTrader Execution API: https://www.jfxjournal.site/api/ctrader/trade (local dev: http://127.0.0.1:3000/api/ctrader/trade)

Environment (.env downloaded from Settings → Developer Tools):
```
JFX_KEY=jfx_pat_...
JFX_BASE=https://lwlikhjgwazyrahucatl.supabase.co/functions/v1/jfx-api
JFX_CTRADER_TRADE_URL=https://www.jfxjournal.site/api/ctrader/trade
```

Auth headers (either works — do not mix a truncated key):
- `X-API-Key: $JFX_KEY` (preferred)
- `Authorization: Bearer $JFX_KEY`

Copy the FULL key (starts with `jfx_pat_`). Do not trim, wrap, or URL-encode it.

---

## 1. Journal & Analytics Requests

- Latest trade: `GET /v1/trades?limit=1`
- Recent trades: `GET /v1/trades?limit=20`
- Trade summary: `GET /v1/analytics/summary`
- Monthly summary: `GET /v1/analytics/summary?from=YYYY-MM-DD&to=YYYY-MM-DD`
- Notes: `GET /v1/notes?limit=20`
- Bridge health: `GET /v1/bridge/status`
- Open positions (MT5 bridge): `GET /v1/positions` — requires `bridge:read` (or `trades:read`/`trades:write` also accepted)
- Me: `GET /v1/me` — requires `me:read`

Scopes: `trades:read` for reads, `trades:write` for journal writes and cTrader execution. `trades:write` implies `trades:read` for both journal and cTrader. If you see `403 insufficient_scope`, the key lacks the required scope — tell the user to recreate the key with `trades:write` checked in Settings → Developer Tools.

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

---

## 3. Response behavior

Parse the JSON response and answer from the returned data. Never invent missing trades or metrics. Explain these responses plainly:

- `401 missing_api_key / malformed_token / invalid_token / expired_token` → key missing, truncated, revoked, or expired. Ask the user to press **Test connection** in Settings → Developer Tools, then recreate the key if needed.
- `403 insufficient_scope` → key lacks required scope (`trades:write` for buy/sell). Tell user to recreate key with correct scopes.
- `400 ctrader_not_connected` → key ok, but cTrader not linked. Ask user to connect cTrader on the Connect & Import page.
- `502 ctrader_auth_failed` → stored cTrader grant expired/revoked. Ask user to reconnect cTrader on the Connect & Import page, then retry.
- `404`: the requested resource does not exist
- `429 rate_limited` → retry after the indicated delay. `503 rate_limiter_unavailable` means the server limiter is down — retry shortly, do not recreate the key.

When the user asks "What was my last trade?", call `GET /v1/trades?limit=1`, inspect the returned record, and summarize the pair, direction, entry/exit, result, P&L, and date when available.
