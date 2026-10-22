# JournalFX — Product Requirements (source of truth for `/direction`)

> Every change should move the product toward this document. If you build
> something that isn't here, either it's drift (remove it) or the plan changed
> (the owner updates this file). Update `specs/features.json` alongside.

## 1. What it is
JournalFX (JFX Journal, www.jfxjournal.site) is an AI-powered trading journal for
forex/CFD traders — web app, Android APK (Capacitor) and desktop. It turns trade
history into discipline: log or auto-import trades, see honest analytics, set
rules that actually lock you out, and get AI coaching on your own data.

## 2. Who it's for
- **Beginner retail traders** building a journaling habit and discipline.
- **Active day traders / prop-firm traders** who need deep analytics and rule enforcement.
- **Trading educators** (launch partners) who send their students to it.

## 3. Core jobs (in priority order)
1. **Capture every trade with zero friction** — manual Log Trade (3-step form,
   Quick Log), cTrader OAuth sync, MT5 bridge/EA, CSV/statement import.
2. **Never lose or corrupt trade data** — correct P&L, direction, sessions, portfolio assignment.
3. **Show the truth about performance** — Dashboard, Analytics widgets, reports, equity/drawdown.
4. **Enforce discipline** — Rules, checklists, Playbook, trading locks (pair whitelist, max trades, lot guard).
5. **AI coaching on the user's own data** — AI Assistant with generative UI cards (OpenUI), trading-plan wizard.
6. **Practice and research** — Backtest Lab, bar replay, Market Grid charts, economic calendar.
7. **Organise** — Portfolios (journals per account), Notebook.
8. **Connect programmatically** — JFX API keys (Developer Tools) for agents/automation.

## 4. Non-negotiables
- Data integrity over speed (see AGENTS.md §0.2 and §3).
- Works on mobile (APK) as well as desktop, dark and light themes.
- Trading actions only ever on explicit user confirmation.
- Secrets never reach the client bundle or logs.
- Free/beta users see restricted features clearly marked, never broken.

## 5. Out of scope (drift if it shows up)
- Social feed / copy trading.
- Executing trades automatically without user confirmation.
- Brokers or asset classes we can't actually sync.
- Re-skins or rewrites of working screens without a request.

## 6. Success metrics
- **Error-free sessions:** % of `/flows` runs where every critical flow passes (target 100% before each deploy).
- Time to log a trade (manual) < 30 s.
- Trades synced without manual fix-ups.
- Weekly active journaling users; beta-tester retention.
