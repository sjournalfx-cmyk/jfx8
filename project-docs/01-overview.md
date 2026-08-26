# 01 — Product Overview

**Product:** JournalFX (`jfxjournal.site`)
**Version:** 1.0.0-beta · **Platform:** Web (desktop-first, mobile blocked)
**Stack:** React 19 + TypeScript + Vite + Tailwind + Supabase + Vercel serverless

## What it is

A trading journal for forex/CFD traders: log every execution, review
performance with deep analytics, manage rules and psychology, sync trades
automatically from trading platforms, backtest strategies on real candle data,
and get AI-assisted insight into both trades and mindset.

## Target users

- Professional day traders wanting analytics-driven improvement
- Beginners building disciplined journaling habits
- Prop-firm style traders tracking rules adherence

## App surfaces (sidebar order)

| View id | Name | Purpose |
|---|---|---|
| `dashboard` | Dashboard | KPI cards (Net PnL, Win Rate, Avg R:R, Profit Factor), equity curve widget, open positions widget, daily bias calendar, economic calendar |
| `ea-setup` | Connect & Import | Connection hub — Desktop Bridge wizard, cTrader OAuth terminal, CSV import |
| `log-trade` | Log Trade | Multi-step trade entry form (details → screenshots → review); also used for editing |
| `history` | Journal | Chronological trade list; expandable rows; bulk select/delete/link-to-setup; screenshot lightbox |
| `analytics` | Analytics | Tabbed deep stats: overview widgets, per-symbol/per-pair, strategy performance, mistakes, sessions/time matrix, reports & comparison, cash transactions |
| `notes` | Notebook | Rich-text notes with tags/colors/pinning; playbook & rules views |
| `charts` | Market Grid | Multi-chart TradingView layout (persisted configs) |
| `backtest-lab` | Backtest Lab | Historical replay on real candles from the shared candle store; drawing tools, trade simulation, optimization heatmap |
| `ai-chat` | AI Assistant | Chat about trades/analytics/psychology; voice input; auto-detects calendar questions |

System items: notifications, settings (profile/account/appearance/billing/security/help), quick-log modal.

## Subscription tiers

Normalized via `normalizePlan()` in `lib/constants.ts`:

| Plan | normalizePlan | Gets |
|---|---|---|
| FREE TIER (JOURNALER) | `FREE` | Core journal, dashboard, analytics basics, notes. Balance = manual only |
| PRO TIER (ANALYSTS) | `HOBBY` | + automated import (bridge/cTrader/CSV), advanced analytics, broker-synced balance, custom chart layout, strategy mapper, AI research mode |
| PREMIUM (MASTERS) | `STANDARD` | Everything, premium avatars, priority support |

Restricted sidebar items show a lock icon for basic tier.

## Demo mode

First-time users (onboarded, zero trades) land in a reversible demo journal:
18 sample trades over a rolling recent 3-month window, plus sample notes,
daily bias, EA session, and a demo profile overlay. Read-only — mutations are
blocked with toasts; destructive affordances hidden. Toggle via the
"Try Demo"/"Exit Demo" pill under the sidebar avatar or onboarding's
"Explore with Demo Data". Full details: [05-demo-mode.md](05-demo-mode.md).

## Key product rules

1. **Journal PnL is sacred** — explicit user-entered PnL is preserved by
   normalization unless recalculation is explicitly requested.
2. **Broker balance only overrides journal math when genuinely connected**
   (see [03-connections-and-data-integrity.md](03-connections-and-data-integrity.md)).
3. **Demo never leaks real data** and real state is never polluted by demo.
4. **FREE tier never uses broker-derived balances.**

## Glossary (quick)

- **EA / Bridge**: Windows EXE + MQL5 EA that streams MT5 account data to Supabase in real time.
- **cTrader Open API**: OAuth + WebSocket protocol used for direct account sync.
- **Shared candle store**: server-harvested OHLCV history all users read (Backtest Lab).
- **SAST**: South African Standard Time (UTC+2) — the app's canonical timezone for trade dates.
