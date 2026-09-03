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

Scopes: any trade execution (`open`, `close`, `modify_position`, `modify_order`, `cancel_order`, also aliases `buy`/`sell` and fields `pair`/`instrument`/`ticker` as aliases for `symbol`) requires `trades:write`. Reading positions requires `trades:read` (or `trades:write`).
`isDemo` accepts boolean or string (`true`/`false`); `true` = demo host, `false` = live host. When in doubt, omit it — the server falls back to the stored default.

If you get `400 ctrader_not_connected`, the user's key is valid but their cTrader account has not been linked yet — instruct them to connect cTrader once in the JFX web app on the **Connect & Import** page. If you get `502 ctrader_auth_failed`, ask them to reconnect cTrader (stored grant expired).

### Get Open Positions & Pending Orders
```json
{
  "action": "get_positions",
  "isDemo": true
}
```

```bash
curl -sS -H "X-API-Key: $JFX_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"get_positions","isDemo":true}' \
  "${JFX_CTRADER_TRADE_URL:-https://www.jfxjournal.site/api/ctrader/trade}"
```

### Open Market, Limit, or Stop Order
```json
{
  "action": "open",
  "symbol": "EURUSD",
  "side": "buy",
  "volume": 0.01,
  "orderType": "market",
  "stopLoss": 1.0750,
  "takeProfit": 1.0950,
  "isDemo": true,
  "comment": "Opened by AI agent"
}
```

```bash
curl -sS -H "X-API-Key: $JFX_KEY" -H "Content-Type: application/json" \
  -d '{"action":"open","symbol":"EURUSD","side":"buy","volume":0.01,"orderType":"market","isDemo":true}' \
  "${JFX_CTRADER_TRADE_URL:-https://www.jfxjournal.site/api/ctrader/trade}"
```

### Close Position (Full or Partial)
```json
{
  "action": "close",
  "positionId": 9876543,
  "volume": 0.01,
  "isDemo": true
}
```

### Modify Position (Stop Loss & Take Profit)
```json
{
  "action": "modify_position",
  "positionId": 9876543,
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
