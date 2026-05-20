# FMP Free Data Tools — Design Spec

**Date:** 2026-05-18
**Status:** Draft (pending user review)

## Overview

Replace the broken Economic Calendar button (requires FMP Premium, returning 401) with an **expandable Data Tools panel** that surfaces 8 endpoints from FMP's free plan. The panel sits above the AI Chat input bar and replaces the single Calendar icon button.

## Layout

A collapsible toolbar strip above the chat input bar, toggled by a **"Data Tools" button** in the input bar (same position as the current Calendar button). The panel slides in/out above the input when toggled.

The panel displays two visual groups of tool buttons:

```
[ Instant Fetch ]           [ Requires Symbol ]
📰 News       📈 Movers     💰 Stock Quote
📊 Sector     🗓️ Earnings   🏢 Company Profile
🌍 Econ Indicators
🏦 Treasury Rates
```

Each tool button has an icon and short label. Hovering shows a tooltip with a brief description.

## Tools & Behaviors

### Instant-Fetch Tools

| Tool | API Route | FMP Endpoint | Response Format |
|------|-----------|-------------|-----------------|
| 📰 Market News | `/api/fmp/news` | `/stable/news/general` | Top 5-10 headlines as markdown list |
| 📊 Sector Performance | `/api/fmp/sector-performance` | `/stable/sector-performance` | Table: sector, % change |
| 📈 Market Movers | `/api/fmp/market-movers` | `/stable/stock_market/gainers` (and losers) | Top 5 gainers + top 5 losers |
| 🗓️ Earnings Calendar | `/api/fmp/earnings-calendar` | `/stable/earnings-calendar` | Upcoming earnings: date, symbol, estimate |
| 🌍 Economic Indicators | `/api/fmp/economic-indicators` | `/stable/economic-indicators` | Key macro data (CPI, GDP, unemployment) |
| 🏦 Treasury Rates | `/api/fmp/treasury-rates` | `/stable/treasury-rates` | Yield curve table |

Clicking any instant-fetch tool immediately calls the API and renders the result as a chat message with a badge indicating the tool type.

### Ticker-Dependent Tools

| Tool | API Route | FMP Endpoint | Behavior |
|------|-----------|-------------|----------|
| 💰 Stock Quote | `/api/fmp/quote?symbol=X` | `/stable/quote` | Shows inline input → user types symbol → fetches → shows price, change, volume |
| 🏢 Company Profile | `/api/fmp/profile?symbol=X` | `/stable/profile` | Shows inline input → user types symbol → fetches → shows sector, market cap, description |

When a user selects a ticker-dependent tool, a small inline input row appears directly in the chat area (as a temporary element below the last user message). It contains a text input for the symbol and a Fetch button. The user types the symbol and hits Enter or clicks "Fetch" to retrieve data. A close "×" button discards the input.

## Backend

### API Routes (Vite middleware & Vercel serverless)

All routes proxy to FMP's stable API. Each route extracts the API key from environment variables (FMP_API_KEY or VITE_FMP_API_KEY).

**Vite middleware** — add all 8 routes to the existing `mt5PythonPlugin()` in `vite.config.mjs`, following the same pattern as the current `/api/economic-calendar` middleware.

**Vercel serverless** — create individual files under `api/fmp/*.ts` or a single `api/fmp/[[route]].ts` catch-all that dispatches based on the route suffix.

**All routes share:**
- Same API key reading logic (from `readFmpKey()` helper or env vars)
- Same error handling: 401 → "API key rejected / check key permissions", 429 → "Rate limit hit, try later", other → generic error message
- Same response format: `{ data: ... }` on success, `{ error, status, details }` on failure

### Error Handling

All API failures return a formatted chat message (not raw JSON) indicating what went wrong. The app never exposes raw FMP responses to the user.

## Frontend Changes

### Files Modified

- `components/AIChat.tsx` — Replace `Calendar` button with `Data Tools` toggle button + collapsible panel markup; remove Economic Calendar button; keep the existing `handleSend` flow for data tool results
- `vite.config.mjs` — Add 8 new middleware routes under `/api/fmp/*`
- `api/economic-calendar.ts` — Remove, no longer called from UI
- `services/nvidiaAiService.ts` — Update system prompt guidance: remove Economic Calendar skill instructions, add generic guidance about "live market data available from FMP free endpoints"
- `lib/aiChatFormatting.ts` — Remove `economic-calendar-fetcher` from sanitization strip list (no longer needed)
- `services/nvidiaAiService.test.ts` — Update test for the changed system prompt

### Data Flow

```
User clicks tool button
    → Panel closes
    → If instant: fetch API → format markdown → processResponse() → chat message
    → If ticker: show inline input → user types → fetch API → format → processResponse()
```

## Existing Removal

- Remove the Economic Calendar button from the input bar (line ~3140 in AIChat.tsx)
- Keep `isEconomicCalendarRequest()` interceptor in `handleSend()` — when a user asks about "economic calendar", redirect to fetch Market News & Economic Indicators as free alternatives, with a note that the live calendar is unavailable on the free plan
- Remove the EC badge rendering logic and replace with a generic "Market Data" badge for all data tool responses

## Testing

- Unit tests for each new API formatting function
- Integration test verifying each route proxies correctly (with mock FMP responses)
- Test error handling paths (401, 429, malformed responses)
- Test inline input flow for ticker-dependent tools

## Constraints

- Free FMP plan: 250 requests/day, US stocks, 5 years of data, delayed (end-of-day) quotes
- Budget tool calls wisely — cache aggressively within a session
- All tools should show a brief "data source" note in the response indicating data is from FMP free plan
