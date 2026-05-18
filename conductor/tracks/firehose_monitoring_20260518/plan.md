# Implementation Plan: Firehose Market Monitoring

## Phase 1: Database Schema
- [ ] Create `firehose_rules` table migration (uuid PK, user_id FK, name, lucene_query, active bool default true, created_by text check "ai"/"manual", created_at, last_event_at nullable)
- [ ] Create `firehose_events` table migration (uuid PK, user_id FK, rule_id FK, title, url, source, summary, published_at, seen bool default false)
- [ ] Add RLS policies: users can only see own rules and events
- [ ] Add `types.ts` interfaces: `FirehoseRule`, `FirehoseEvent`
- [ ] Add `lib/constants.ts` entries: route path `/monitoring`, icon name

## Phase 2: Edge Function
- [ ] Create `supabase/functions/sync-firehose/index.ts`:
  - Read `FIREHOSE_API_KEY` from env
  - Query `firehose_rules WHERE active = true`
  - For each rule: connect to Firehose SSE endpoint, drain events, insert into `firehose_events` (dedup by url per user_id)
  - Update `last_event_at` per rule
  - Fault isolation: catch errors per rule, log and continue
- [ ] Deploy Edge Function to Supabase project
- [ ] Set up pg_cron job to invoke `sync-firehose` every 60 seconds

## Phase 3: Monitoring Page
- [ ] Create `components/Monitoring.tsx`:
  - **Rule List section**: cards with toggle, name, query (truncated with expand), created_by badge, delete
  - **AI Suggest Rules button**: calls nvidiaAiService with rule-suggestion prompt → parses `[Rule: name | query]` candidates → user approves individually
  - **Event Feed section**: scrollable list, newest first, source+headline+tag+timestamp, unread highlight
  - **Slide-over panel**: on event click, shows full summary + "Ask AI" button
  - Empty states for no rules / no events
  - Loading skeleton while fetching
- [ ] Add route `/monitoring` in `App.tsx`
- [ ] Add nav item + unread badge in `Sidebar.tsx` (Realtime subscription on `firehose_events WHERE seen = false`)
- [ ] Add nav item + badge in `MobileNav.tsx`

## Phase 4: AI Chat Integration
- [ ] Update system prompt in `services/nvidiaAiService.ts`:
  - Add Firehose context: AI knows about market monitoring events stored in DB
  - Rule suggestion format: `[Suggest Rule: <name> | <lucene_query>]`
  - Instruct AI to reference recent events when discussing markets or instruments
- [ ] Implement "Ask AI about this" flow: pass event context via navigation state → AI Chat reads state → injects into next request context
- [ ] Handle `[Suggest Rule: ...]` output in chat: render as clickable button → opens approval flow

## Phase 5: Testing
- [ ] Edge Function: mock Firehose SSE endpoint, test empty/dedup/error scenarios
- [ ] Monitoring page: render tests for rule list, event feed, toggle, delete, slide-over
- [ ] AI suggestion flow: mock nvidiaAiService, verify rule candidate parsing
- [ ] Integration: verify Realtime badge count updates on new events
