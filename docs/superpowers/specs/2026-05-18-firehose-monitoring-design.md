# Firehose Market Monitoring — Design Spec

**Date:** 2026-05-18
**Status:** Approved

## Overview

Integrate the [Firehose API](https://firehose.com/api-docs) (real-time web monitoring via SSE + Lucene queries) into JournalFX's AI Chat. Users can monitor financial news and market-moving events globally, with AI-driven rule suggestions, background polling via a Supabase Edge Function, and proactive AI analysis of relevant events.

## Architecture

```
[User] ←→ [JournalFX React App]
              ├── Monitoring Page (rule management + event feed)
              ├── AI Chat (event context + rule suggestions)
              └── Sidebar (nav item + unread badge)

[Supabase]
  ├── firehose_rules table
  ├── firehose_events table
  └── Realtime (pushes new events to frontend)

[Supabase Edge Function: sync-firehose]
  └── Cron trigger (every 60s)
       └── Reads active rules → polls Firehose SSE → stores events
```

Chosen approach: scheduled polling via Supabase Edge Function (60s interval). No persistent connections — fits Supabase's execution model while catching every market-moving article, earnings report, and rate decision within a reasonable window.

## Database Schema

### `firehose_rules`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| user_id | uuid FK → users | |
| name | text | User-friendly label (e.g. "ZAR News") |
| lucene_query | text | e.g. `title:zar OR title:"south africa" AND page_category:"/News"` |
| active | boolean | Toggle on/off without deleting |
| created_by | text | `"ai"` or `"manual"` |
| created_at | timestamptz | |
| last_event_at | timestamptz | Null until first match |

### `firehose_events`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| user_id | uuid FK → users | |
| rule_id | uuid FK → firehose_rules | |
| title | text | Article headline |
| url | text | Link to source |
| source | text | e.g. "Reuters", "Bloomberg" |
| summary | text | Firehose-provided excerpt |
| published_at | timestamptz | When the article published |
| seen | boolean | Whether user has viewed it |

## Edge Function

**File:** `supabase/functions/sync-firehose/index.ts`

- Triggered by pg_cron every 60 seconds
- Queries `firehose_rules WHERE active = true`
- For each rule: connects to Firehose SSE endpoint with the API key, collects events since last check, inserts into `firehose_events`
- Deduplicates by URL per user (same article matching multiple rules = one event)
- Updates `last_event_at` on the rule on success
- On failure: logs error, moves to next rule (fault isolation)

**Environment variable:** `FIREHOSE_API_KEY`

## Monitoring Page

**Route:** `/monitoring`

Two zones:

### Rule List (top section)
- Each rule displayed as a compact card: toggle switch, name, Lucene query (truncated with expand), created-by badge, delete button
- **"AI Suggest Rules"** button in the header — calls `nvidiaAiService` with a special "rule suggestion" prompt containing the user's open trades, watched symbols, and portfolios as formatted context. AI returns 2-3 Lucene rule candidates as structured text (`[Rule: name | query]`). User reviews and approves individually. Approved rules saved to `firehose_rules`.
- Empty state: prompt user to click "AI Suggest Rules" or create a manual rule

### Event Feed (below)
- Scrollable list of captured events, newest-first
- Each event shows: source, headline (clickable link), rule name tag, relative timestamp
- Unread events highlighted with a subtle background
- Clicking an event opens a slide-over panel with full summary + **"Ask AI about this"** button
- "Ask AI" routes to AI Chat with event context preloaded

## AI Chat Integration

### System Prompt Update
Add guidance: the AI has access to Firehose real-time market monitoring. When a user asks about markets or instruments, the AI checks for recent Firehose events. The AI can suggest new monitoring rules — formatted as `[Suggest Rule: <name> | <lucene_query>]` so the UI can prompt the user to approve.

### "Ask AI about this" Flow
User clicks button on event slide-over → routes to `/ai-chat?context=firehose&eventId=<id>` → Monitoring page passes event data via navigation state → AI Chat reads the event from state, injects event details into the next AI request context (title, summary, source, link, relevance to open trades) → AI analyzes market impact.

## Sidebar + Navigation

- New nav item: **"Monitoring"** with antenna/broadcast icon (lucide `Radio` or equivalent)
- Badge shows count of unseen events, updated via Supabase Realtime subscription on `firehose_events WHERE seen = false`
- Same item in `MobileNav.tsx`

## Frontend Changes

### New Files
- `components/Monitoring.tsx` — Full monitoring page (rule list + event feed + slide-over)
- `supabase/functions/sync-firehose/index.ts` — Edge Function

### Modified Files
- `App.tsx` — add `/monitoring` route
- `Sidebar.tsx` — add nav item + unseen count badge
- `MobileNav.tsx` — add nav item + unseen count badge
- `services/nvidiaAiService.ts` — update system prompt with Firehose context
- `lib/constants.ts` — add route path, event categories
- `types.ts` — add `FirehoseRule`, `FirehoseEvent` types

### Data Flow

```
1. User opens app → Realtime subscription counts unseen events → badge updates
2. User clicks "AI Suggest Rules" → AI reads trades → returns candidates → user approves → saved to DB
3. Edge Function (60s cron) → reads active rules → polls Firehose → stores events → Realtime pushes to UI
4. User sees event → clicks "Ask AI" → context sent to AI Chat → AI analyzes
```

## Testing

### Edge Function
- Mock Firehose SSE responses (empty stream, new events, malformed data)
- Verify deduplication by URL
- Verify error isolation (one failing rule doesn't block others)

### Monitoring Page
- Render rule list, toggle active/inactive, delete rule
- Event feed rendering, seen/unseen states
- "AI Suggest Rules" flow with mock AI response
- Slide-over panel open/close

### AI Integration
- System prompt correctly references Firehose
- Rule suggestion output format matches expected pattern

## Constraints

- Firehose is in free beta — no rate limits documented but treat as 100 req/min per user
- Edge Function max execution: 60s on Supabase free tier (poll all rules within this window)
- SSE connections are ephemeral per poll cycle (connect → drain → disconnect)
- Only one Firehose API key (shared across all users — stored as Edge Function env var)
