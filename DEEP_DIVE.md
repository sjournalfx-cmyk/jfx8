# JournalFX Deep Dive

This document explains how the app is structured and what the major widgets do.

## Product Shape

JournalFX is organized around a simple workflow:

1. Log trades.
2. Review performance.
3. Study patterns.
4. Refine rules and process.
5. Sync live trades through the desktop bridge when enabled.

The app is split into a few major surfaces:

- Dashboard
- Journal
- Analytics
- Notebook
- Charts / Market Grid
- Backtest Lab
- AI Assistant
- Desktop Bridge
- Broker
- Settings

## Dashboard Deep Dive

The Dashboard is the trader's home screen. It is built to answer one question quickly: "How is the account doing right now?"

### Stat Cards

The top row of cards gives a fast snapshot of account health.

- `Net PnL` shows realized profit or loss from closed trades.
- `Win Rate` shows the percentage of trades that closed in profit.
- `Profit Factor` compares gross profit against gross loss.
- `Total Trades` shows how much activity exists in the journal.

These cards are the first layer of performance review. They tell you whether the journal is growing, stagnating, or deteriorating.

### Session Clock

The session clock tracks the current trading session and helps you orient activity in market time rather than local desktop time.

### Daily Quote

The quote widget is a lightweight mindset panel. It is there to reinforce discipline and keep the user focused on process.

### Daily Bias Widget

This widget lets you set a market bias for each day of the week:

- Bullish
- Bearish
- Neutral

Why it matters:

- It creates a pre-trade intention.
- It helps compare planned direction versus executed trades.
- It supports later review of alignment or mismatch.

In the free tier, this area is locked in the current UI.

### Recent Activity

Recent Activity lists the latest closed trades and pending offline items.

What it shows:

- pair / symbol
- direction
- result
- realized PnL
- pending sync state if trades are queued offline

This is the fastest way to verify that the journal is receiving trades correctly.

### Equity Curve Widget

The equity curve is the main growth chart.

What it does:

- plots cumulative balance over time
- shows whether the account is trending up, flat, or down
- reveals drawdowns, plateaus, and recovery periods

How to read it:

- a rising slope means the system is growing
- a flat section means stalled performance
- a sharp drop means a drawdown event

### Open Positions Widget

This widget shows live positions from the bridge session.

What it does:

- lists current open trades
- shows floating PnL
- shows cached last sync time
- displays whether the account is demo or real

This widget is also locked behind the higher tiers in the current UI because it depends on live bridge data.

### Layout Presets

Dashboard widgets can be reordered and saved using layout presets:

- Standard
- Execution
- Analytics

This matters because different traders want different first-screen priorities.

## Analytics Deep Dive

Analytics is the most detailed part of the app. It is split into tabs so you can analyze the journal from different angles.

### Overview Tab

The overview tab combines the main health indicators:

- `Win Rate` - raw winning percentage
- `Profit Factor` - gross profit divided by gross loss
- `Gross Profit` - total positive PnL
- `Gross Loss` - total negative PnL
- `Equity Curve` - account growth over time
- `Drawdown Over Time` - peak-to-valley decline history
- `Currency Strength` - currency-based trade strength meter
- `Risk/Reward` - compares average win to average loss
- `Trade Grade Distribution` - rating spread of all trades

What the tab is for:

- quick health check
- capital curve review
- identifying whether the edge is stable
- spotting risk asymmetry early

### Trades Tab

The trades tab answers: "What am I actually good or bad at?"

Widgets:

- `Symbol Performance` - performance by symbol/pair
- `Largest Win/Loss` - biggest positive and negative trades
- `Outcome Distribution` - mix of wins, losses, breakevens, and pending trades
- `Pair Distribution Treemap` - concentration of results across pairs

What to look for:

- overexposure to one symbol
- outlier winners or losers
- whether one market is driving most of the result

### Psychology Tab

This tab is about trader behavior, not just market outcomes.

Widgets:

- `Trade Momentum` - streaks, clustered outcomes, and recovery signals
- `Tilt Score` - flags emotional or impulsive trading behavior
- `PL by Mindset` - PnL grouped by mindset tags
- `PL by Plan Adherence` - PnL grouped by rule adherence
- `Psychological Slip` - spots recurring psychology failures

What this tab tells you:

- whether the trader is in control
- whether good process is producing good results
- whether repeated emotional mistakes are hurting edge quality

### Session Tab

The session tab breaks results down by market timing.

Widgets:

- `Market Session` - performance by London, New York, Asian, or similar session buckets
- `Hourly Performance` - results by hour
- `Daily Activity Heatmap` - when the trader is most active and most effective

Why this matters:

- time-of-day can be a hidden edge or hidden weakness
- some traders perform well in the first hour and badly later
- certain sessions may consistently produce better trades

### Correlation / Time Lab

This section looks at how trade size, timing, and symbol combinations affect results.

Widgets:

- `Lot Size PnL Distribution` - checks whether bigger size is helping or hurting
- `Pair Correlation Matrix` - shows relationships between traded symbols
- `Time Analysis Matrix` - maps results across time buckets

What this section is for:

- finding hidden clustering
- identifying whether sizing is correlated with bad results
- checking if certain symbols move together in a way that affects performance

### Advanced Tab

This tab contains deeper review tools.

Widgets:

- `Strategy Performance Pie Chart` - share of results by strategy
- `Trading Mistakes Bar Chart` - repeated mistakes ranked by frequency or impact

Use this tab to answer:

- which strategies dominate the journal
- which mistakes recur most often
- where process errors are concentrated

### Comparison Tab

The comparison view is for side-by-side analysis.

Use cases:

- compare one symbol against another
- compare one session against another
- compare one strategy against another
- compare psychological states or rule adherence levels

### Reports Tab

The reports area combines printable and export-style analytics.

It includes:

- detailed statistics
- a report view
- execution performance table
- pair and symbol summaries
- outcome and adherence reporting

This is the most presentation-ready part of analytics.

### Cash Tab

The cash tab tracks non-trade account movements.

Use it for:

- deposits
- withdrawals
- adjustments
- balance-related cash activity

This matters because not all account movement comes from trading PnL alone.

## Journal Deep Dive

The Journal is where trade records are reviewed and edited.

What it supports:

- full trade history
- editing trade fields
- notes and exit comments
- screenshots and attachments
- tagging and categorization
- trade filtering and cleanup
- comment editing directly from the history table

Why it matters:

- it is the source of truth for performance analysis
- it feeds the analytics widgets
- it is where execution quality gets documented

## Notebook Deep Dive

The Notebook is a flexible note system for traders.

What it supports:

- rich notes
- pinning
- archiving
- trash management
- labels
- lists
- images
- tables
- drag-and-drop ordering
- Gemini-assisted note creation

Best use cases:

- record playbook ideas
- capture post-trade reflections
- store process rules
- write market preparation notes

## Charts / Market Grid

The charting area is built for visual market review.

What it does:

- embeds TradingView
- supports multiple chart layouts
- preserves chart configurations
- supports drawings and annotations
- enables focus-mode style analysis

Best use cases:

- multi-symbol monitoring
- review of setups and structure
- marking entries, exits, and invalidation levels

## Backtest Lab

Backtest Lab is for strategy testing and visual review.

What it does:

- runs historical trade scenarios
- stores backtest sessions
- preserves drawings
- supports undo / redo for drawing states
- helps review idea quality before live use

Best use cases:

- test rule changes
- compare setups
- validate strategy ideas before risking capital

## AI Assistant Deep Dive

The AI Assistant is meant to help with trading workflow, not replace it.

It is used for:

- trade analysis
- journal summaries
- strategy planning
- note generation
- voice note transcription support
- mindset and behavior prompts

The AI layer works best when fed real journal data instead of general prompts.

## Desktop Bridge Deep Dive

The Desktop Bridge connects JournalFX to MetaTrader 5.

What it does:

- generates a sync key
- monitors heartbeat and connection state
- syncs terminal trades into the journal
- can work with local headless MT5 data
- supports live open positions when connected

Why it matters:

- it reduces manual entry
- it keeps the journal current
- it enables live positions and bridge monitoring

## Broker Section

The Broker area is present in the app shell, but the current UI marks it as under maintenance.

## Plan Behavior

The app currently uses these plan tiers:

| Plan | Summary |
| --- | --- |
| Free Tier (Journaler) | Manual journaling with tight limits |
| Pro Tier (Analysts) | Higher trade limits and broader analysis |
| Premium (Masters) | Full feature set, including AI and live sync |

Premium-oriented capabilities in the current code include:

- unlimited trades
- unlimited notes
- unlimited images
- comparison analytics
- multi-chart layouts
- direct broker sync
- AI insights
- voice notes
- headless MT5 support

## Reading Strategy

If you are new to the app, read the widgets in this order:

1. Dashboard stat cards
2. Equity curve
3. Drawdown
4. Symbol performance
5. Trade momentum
6. Plan adherence
7. Mistake analysis
8. Session analysis
9. Strategy and comparison views

That sequence moves from "what happened" to "why it happened" to "how to improve it."

## Main Takeaway

JournalFX is not just a trade logger. It is a workflow for:

- recording execution
- measuring edge
- checking emotional discipline
- reviewing time/symbol/session patterns
- syncing live data
- iterating on rules and strategy

If you want, I can also turn this into a more polished product manual with screenshots, callouts, and a table of contents for each screen.
