# JournalFX — Project Documentation

> **Start here.** This folder is the single source of truth for understanding
> JournalFX from A to Z. Written for both humans and AI agents.

## Reading order

| # | File | What it covers |
|---|------|----------------|
| 1 | [01-overview.md](01-overview.md) | What the product is, who it's for, every feature surface, plans & limits |
| 2 | [02-architecture.md](02-architecture.md) | Tech stack, folder map, data flow, state management, key subsystems |
| 3 | [03-connections-and-data-integrity.md](03-connections-and-data-integrity.md) | The three trade-ingestion paths (Desktop Bridge, cTrader, CSV), balance/equity resolution rules, unit conventions, known pitfalls |
| 4 | [04-shared-candle-store.md](04-shared-candle-store.md) | Server-side candle harvesting: architecture, config, operations runbook |
| 5 | [05-demo-mode.md](05-demo-mode.md) | Demo journal mode: design rules, guard rails, date-window system |
| 6 | [06-setup-and-deployment.md](06-setup-and-deployment.md) | Local setup, env vars, Supabase, deploy workflow, cron/pinger, troubleshooting |

## Legacy files (root / docs/)

The older markdown files in the repo root and `docs/` are superseded by this
folder and kept only for historical reference:

- `ARCHITECTURE.md`, `DEEP_DIVE.md`, `DOCUMENTATION.md`, `DEMO_MODE_SPEC.md`,
  `CTRADER_DEPLOYMENT_FIXES.md`, `frontend-optimization-plan.md`, `SETUP.md`,
  `docs/deployment.md`, `docs/service-account.md`, `docs/shared-candle-store*.md`
  → all merged into the six files above.
- `conductor/`, `social/`, `services/AI_RULES.md` → unrelated to app docs;
  left untouched.

**Do not update the legacy files.** Update the numbered docs here instead.
