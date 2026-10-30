# JFX Journal Agent Skill

This package teaches Claude Code, Codex CLI, Hermes, and other tool-capable agents how to use the JFX Journal API and cTrader live execution.

It contains instructions and examples only. **Never commit a real `JFX_KEY` to this repository.** Store the key in the agent's environment or a secret manager.

## Install

Copy `SKILL.md` into the agent's skills directory. For Claude Code, a typical project-local path is `.claude/skills/jfx-journal/SKILL.md`. For Codex-compatible loaders, use `$CODEX_HOME/skills/jfx-journal/SKILL.md`.

Or use the in-app download: JFX Journal → Settings → Developer Tools → `Copy instructions` / `Download SKILL.md` (always the latest).

Set the key before starting the agent:

```bash
export JFX_KEY="jfx_pat_..."
export JFX_BASE="https://lwlikhjgwazyrahucatl.supabase.co/functions/v1/jfx-api"
export JFX_CTRADER_TRADE_URL="https://www.jfxjournal.site/api/ctrader/trade"
```

PowerShell:

```powershell
$env:JFX_KEY = "jfx_pat_..."
$env:JFX_BASE = "https://lwlikhjgwazyrahucatl.supabase.co/functions/v1/jfx-api"
$env:JFX_CTRADER_TRADE_URL = "https://www.jfxjournal.site/api/ctrader/trade"
```

## Quick tests

Journal (requires `trades:read`):
```bash
curl -sS -H "X-API-Key: $JFX_KEY" "${JFX_BASE:-https://lwlikhjgwazyrahucatl.supabase.co/functions/v1/jfx-api}/v1/trades?limit=1"
```

Economic calendar (requires `calendar:read`):
```bash
curl -sS -H "X-API-Key: $JFX_KEY" "${JFX_BASE:-https://lwlikhjgwazyrahucatl.supabase.co/functions/v1/jfx-api}/v1/calendar"
```

Checklists (requires `checklists:read`):
```bash
curl -sS -H "X-API-Key: $JFX_KEY" "${JFX_BASE:-https://lwlikhjgwazyrahucatl.supabase.co/functions/v1/jfx-api}/v1/checklists"
```

Trading locks (requires `locks:read`):
```bash
curl -sS -H "X-API-Key: $JFX_KEY" "${JFX_BASE:-https://lwlikhjgwazyrahucatl.supabase.co/functions/v1/jfx-api}/v1/locks"
```

Balance & equity (requires `account:read`):
```bash
curl -sS -H "X-API-Key: $JFX_KEY" -H "Content-Type: application/json" \
  -d '{"action":"account_summary"}' \
  "${JFX_CTRADER_TRADE_URL:-https://www.jfxjournal.site/api/ctrader/trade}"
```

cTrader positions (requires `trades:read` or `trades:write`):
```bash
curl -sS -H "X-API-Key: $JFX_KEY" -H "Content-Type: application/json" \
  -d '{"action":"get_positions","isDemo":true}' \
  "${JFX_CTRADER_TRADE_URL:-https://www.jfxjournal.site/api/ctrader/trade}"
```

cTrader open demo trade (requires `trades:write`; `isDemo:true` for demo, `false` for live):
```bash
curl -sS -H "X-API-Key: $JFX_KEY" -H "Content-Type: application/json" \
  -d '{"action":"open","symbol":"EURUSD","side":"buy","volume":0.01,"orderType":"market","isDemo":true}' \
  "${JFX_CTRADER_TRADE_URL:-https://www.jfxjournal.site/api/ctrader/trade}"
```

cTrader candles (GET only; `symbol` or `symbolId`; requires `trades:read`):
```bash
curl -sS -H "X-API-Key: $JFX_KEY" \
  "${JFX_CTRADER_CANDLES_URL:-https://www.jfxjournal.site/api/ctrader/candles}?symbol=EURUSD&timeframe=H1&count=50"
```

Portfolio registry (canonical ids for /v1/locks targets; requires `trades:read` or `locks:read`):
```bash
curl -sS -H "X-API-Key: $JFX_KEY" "$JFX_BASE/v1/portfolios"
```

Trades filters (open/closed + slim responses):
```bash
curl -sS -H "X-API-Key: $JFX_KEY" "$JFX_BASE/v1/trades?status=open&include=candles:false&fields=id,pair,date,entry_price,exit_price,pnl,portfolio_id"
```

## Scopes

In Settings → Developer Tools when creating a key:
- `trades:read` — read journal trades & analytics (and cTrader `get_positions`)
- `trades:write` — **required for buy/sell** (open/close/modify cTrader positions + journal writes). Implies `trades:read`.
- `account:read` — balance, equity & margin from the connected cTrader account
- `calendar:read` — this week's economic calendar events
- `checklists:read` / `checklists:write` — strategy checklist templates and their items
- `locks:read` / `locks:write` — per-portfolio trading locks (allowed pairs, max trades/day, lot range). Lock semantics mirror the app: tightening applies now, loosening waits 24h, disabling starts a 24h cooling countdown. Also unlocks lock details in `get_portfolios`.
- `bridge:read` — MT5 bridge (`GET /v1/positions` via bridge). cTrader positions use `trades:read` instead.

Existing keys cannot gain scopes — create a new one with the scopes you need. If you see `403 insufficient_scope`, recreate the key with the missing scope checked. If you see `400 ctrader_not_connected`, connect cTrader once on the **Connect & Import** page — the API key then mints broker tokens server-side. If you see `400 no_live_account_connected`, the request used `isDemo:false` but no live account is connected — connect a live account on the Connect cTrader page or retry with `isDemo:true`. If you see `502 ctrader_auth_failed`, reconnect cTrader (stored grant expired). Use **Test connection** in Settings → Developer Tools before handing a key to an agent — it checks journal + cTrader reachability without opening a trade.

Both headers work: `X-API-Key: $JFX_KEY` (preferred) or `Authorization: Bearer $JFX_KEY`. Copy the FULL key starting with `jfx_pat_`.

Create the API key in JFX Journal under **Settings → Developer Tools**.
