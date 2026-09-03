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

## Scopes

In Settings → Developer Tools when creating a key:
- `trades:read` — read journal trades & analytics (and cTrader `get_positions`)
- `trades:write` — **required for buy/sell** (open/close/modify cTrader positions + journal writes). Implies `trades:read`.
- `bridge:read` — MT5 bridge (`GET /v1/positions` via bridge). cTrader positions use `trades:read` instead.

If you see `403 insufficient_scope need trades:write`, recreate the key with `trades:write` checked. If you see `400 ctrader_not_connected`, connect cTrader once on the **Connect & Import** page — the API key then mints broker tokens server-side. If you see `502 ctrader_auth_failed`, reconnect cTrader (stored grant expired). Use **Test connection** in Settings → Developer Tools before handing a key to an agent — it checks journal + cTrader reachability without opening a trade.

Both headers work: `X-API-Key: $JFX_KEY` (preferred) or `Authorization: Bearer $JFX_KEY`. Copy the FULL key starting with `jfx_pat_`.

Create the API key in JFX Journal under **Settings → Developer Tools**.
