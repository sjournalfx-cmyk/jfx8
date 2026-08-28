# AIChat: Remove All Slash Commands Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Strip the entire slash-command system (`/quote`, `/calendar`, etc.) out of `components/AIChat.tsx` — the command palette overlay, keyboard handling, dispatch logic, usage tracking, and the dead data-tool fetchers only reachable via those commands — leaving plain chat (text/voice) plus the existing Features and Quick Prompts menus untouched.

**Architecture:** Single-file surgical removal in `components/AIChat.tsx`. The slash system has five coupled parts: (1) `SlashCommand` type + `SLASH_COMMANDS` registry, (2) suggestion-overlay UI block, (3) input keydown interception, (4) dispatch inside `handleSend`, (5) `handleSelectCommand`. Behind it sit three fetch helpers (`handleFetchDataTool`, `handleFetchFinnhubDataTool`, `handleFetchForexFactoryCalendar`) whose ONLY callers are slash paths — they go too, along with their now-unused imports. A separate economic-calendar auto-fetch exists elsewhere in the file (line ~1726 error message references `/calendar`) — that toast text gets reworded, but its fetch logic is independent and stays.

**Tech Stack:** React/TypeScript, framer-motion (already imported), no new deps.

---

## Current context (verified in repo)

- `components/AIChat.tsx` (~3726 lines). Slash system spans:
  - Lines 937–968: `type SlashCommand` + `SLASH_COMMANDS` array (19 commands: FMP tools, Finnhub tools, ForexFactory calendar)
  - Line 986: `commandsSuppressed` state
  - Line 1060: `selectedCommandIndex` state
  - Line 1062: `commandUsage` localStorage hook (`jfx_ai_command_usage`)
  - Line 1061: `commandListRef`
  - Lines 1064–1094: `filteredCommands` memo + scroll-into-view effect + reset effect
  - Lines 1618–1653: slash dispatch inside `handleSend` (parses `/cmd symbol`, routes to FMP/Finnhub handlers)
  - Lines 1946–2036: `handleFetchDataTool`, `handleFetchFinnhubDataTool` — check for other callers before deleting
  - Line 2038: `handleFetchForexFactoryCalendar` — also called ONLY from slash/select-command paths; delete with its imports
  - Lines 2071–2097: `handleSelectCommand`
  - Lines 3473–3530: suggestion overlay JSX (AnimatePresence block)
  - Lines 3563–3592: input `onChange` reset of `commandsSuppressed` and keydown ArrowUp/Down/Enter/Tab/Escape interception
- Imports at lines 9–10 (`fmpDataTools`, `finnhubDataTools`) used by both slash system AND possibly other code — verify each symbol's remaining usage before removing.
- `handleFetchForexFactoryCalendar` body may use a forexfactory service import — verify.
- The Features menu (`showFeaturesMenu`, lines ~3293–3363) and Quick Prompt menu (`showForgeMenu`, ~3365+) are SEPARATE features — keep them.
- Economic calendar: there is an independent calendar fetch path around line 1700–1730 (auto-included in responses); its failure message mentions "/calendar" — reword only.

## Proposed approach

Delete top-down in dependency order: first the dispatch branch in `handleSend` (removes dependencies on the fetchers), then `handleSelectCommand`, then the three fetch helpers (after confirming zero remaining callers), then the overlay JSX + keydown interception, then state/memo/ref declarations, then the type+registry, then unused imports. Typecheck (`npx tsc --noEmit`) after each major deletion to catch stragglers. No behavior remains for inputs starting with "/" — they will be sent to the AI as ordinary text (acceptable; alternative would be blocking "/" which adds back complexity we're removing).

## Step-by-step plan

### Task 1: Remove slash dispatch from handleSend

**Objective:** Stop `handleSend` from intercepting "/" inputs.

**Files:**
- Modify: `components/AIChat.tsx:1618-1653`

**Steps:**
1. Delete the entire block from the comment `// --- Slash Command Processing ---` through the closing `}` of the `if (normalizedInput.startsWith('/')) { ... }` block (lines 1618–1653).
2. Run `npx tsc -p tsconfig.json --noEmit` → expect NEW unused-var errors for `SLASH_COMMANDS` etc. (fine, removed next tasks); no other errors.
3. Commit: `git add components/AIChat.tsx && git commit -m "refactor(chat): remove slash dispatch from handleSend"`

### Task 2: Remove handleSelectCommand

**Objective:** Delete the click/keyboard selection handler.

**Files:**
- Modify: `components/AIChat.tsx:2071-2097`

**Steps:**
1. Delete `const handleSelectCommand = useCallback(...)` entirely (lines 2071–2097).
2. Typecheck → expect unused errors for `SLASH_COMMANDS`, states.
3. Commit: `refactor(chat): remove handleSelectCommand`

### Task 3: Remove the three fetch helpers (verify no other callers first)

**Objective:** Delete dead data-tool fetch functions.

**Files:**
- Modify: `components/AIChat.tsx:1946-2097` region

**Steps:**
1. `search_files("handleFetchDataTool|handleFetchFinnhubDataTool|handleFetchForexFactoryCalendar", path=".", file_glob="*.tsx")` across whole repo — confirm the only references left in AIChat.tsx are their own definitions (Tasks 1–2 removed all call sites). If any OTHER component calls them, stop and keep those.
2. Delete `handleFetchDataTool` (1946–1992), `handleFetchFinnhubDataTool` (1994–2036), `handleFetchForexFactoryCalendar` (2038–~2069, ends at its closing `};`). Read carefully to capture exact boundaries.
3. Typecheck → collect list of newly-unused imports (likely: fmpDataTools exports at line 9, finnhubDataTools at line 10, forexfactory service import if present near top).
4. For each flagged import symbol, `search_files(symbol)` in AIChat.tsx; remove import only when 0 remaining uses. Likely removable: `formatDataToolResponse`, `formatStatementsMarkdown`, `formatRatiosMarkdown`, `DATA_TOOL_LABELS`, `DATA_TOOL_API_ROUTES`, `DataToolKind`, `formatFinnhubDataToolResponse`, `FINNHUB_TOOL_LABELS`, `FINNHUB_TOOL_API_ROUTES`, `FinnhubToolKind` — but VERIFY each (some labels may render elsewhere).
5. Also delete lib files if now fully orphaned repo-wide: check `lib/fmpDataTools.ts` / `lib/finnhubDataTools.ts` usages outside AIChat (e.g. other components importing API_ROUTES). If truly unused everywhere, `git rm` them; otherwise leave.
6. Commit: `refactor(chat): remove dead data-tool fetchers and imports`

### Task 4: Remove suggestion overlay UI

**Objective:** Delete the popup palette JSX.

**Files:**
- Modify: `components/AIChat.tsx:3473-3530`

**Steps:**
1. Delete the `{/* Slash Command Overlay */}` AnimatePresence block (lines 3473–3530 inclusive of both comment and closing tag).
2. Check whether `AnimatePresence`, `motion`, `Star`, `AlertCircle` still have other uses in the file (they do — menus use AnimatePresence/motion; verify Star & AlertCircle specifically via search; remove from lucide-react import if orphaned).
3. Commit: `refactor(chat): remove slash suggestion overlay`

### Task 5: Simplify input onChange/onKeyDown

**Objective:** Plain Enter-to-send input, no command key hijacking.

**Files:**
- Modify: `components/AIChat.tsx:3563-3592`

**Steps:**
1. Replace `onChange={(e) => { setInput(e.target.value); setCommandsSuppressed(false); }}` with `onChange={(e) => setInput(e.target.value)}`.
2. Replace the whole `onKeyDown` handler with:

```tsx
onKeyDown={(e) => {
  // Don't hijack keys while an IME composition is in progress.
  if (e.nativeEvent.isComposing) return;
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
}}
```

3. Commit: `refactor(chat): simplify chat input keyboard handling`

### Task 6: Remove slash state, refs, memos, registry

**Objective:** Delete now-orphaned declarations.

**Files:**
- Modify: `components/AIChat.tsx:937-968, 986, 1060-1062, 1064-1094`

**Steps:**
1. Delete `type SlashCommand` + `SLASH_COMMANDS` array (937–968).
2. Delete `commandsSuppressed` useState (986), `selectedCommandIndex` useState (1060), `commandListRef` (1061), `commandUsage` useLocalStorage (1062), `filteredCommands` memo + two effects (1064–1094).
3. Full typecheck: `npx tsc -p tsconfig.json --noEmit` → expect ZERO errors related to this work (pre-existing `lib/trade-normalization.ts` error is unrelated, ignore).
4. Lint/build gates: `npm run lint` and `npm run build`.
5. Commit: `refactor(chat): remove slash command state and registry`

### Task 7: Reword stale "/calendar" copy

**Objective:** No user-facing text references removed commands.

**Files:**
- Modify: `components/AIChat.tsx:1728`

**Steps:**
1. Search file for remaining `/` command mentions: `search_files("'/" , path="components/AIChat.tsx")` — fix line 1728 message to drop "or use the `/calendar` command" (e.g. end at "...try again, or check back later.").
2. Grep whole repo for other user-visible mentions of removed commands (`'/quote'`, `'/news'`, etc.) in tsx/ts files; fix any found.
3. Commit: `chore(chat): drop stale slash-command references in copy`

### Task 8: Manual QA + final verification

**Objective:** Prove chat works without the slash system.

**Steps:**
1. `npm run dev`, open AI Chat:
   - Type "hello" + Enter → normal AI reply.
   - Type "/" → NO popup appears; typing "/quote AAPL" + Enter sends it as plain text to the AI (acceptable per plan).
   - Features (⚡) menu opens, Psychology/Scaling or Research starters work.
   - Quick prompts (wand) menu works.
   - Voice record/transcribe flow unaffected.
   - Escape/Arrow keys behave as normal text input.
2. `npm run test` → all pass.
3. Final commit if any stragglers, then push branch per user's workflow.

## Files likely to change

- `components/AIChat.tsx` (only file guaranteed)
- Possibly deleted: `lib/fmpDataTools.ts`, `lib/finnhubDataTools.ts` (only if fully orphaned)
- Possibly touched: any other component importing those libs (verify first)

## Tests / validation

- `npx tsc -p tsconfig.json --noEmit` after every task (ignore pre-existing trade-normalization error)
- `npm run lint`, `npm run build`, `npm run test` at the end
- Manual QA checklist in Task 8

## Risks / tradeoffs / open questions

1. **"/" inputs become plain messages** — users typing "/quote" will get an AI text response instead of live data. Accepted per request ("remove all the slash command/features total"). Open question if you'd rather BLOCK leading-slash sends entirely — trivial follow-up if wanted.
2. **Shared imports** — `Star`, `AlertCircle`, `AnimatePresence` are used by kept menus; only remove lucide icons proven orphaned.
3. **lib/fmpDataTools & finnhubDataTools** may be referenced by tests (`test/` dir) — search before deleting; keep files if tests reference them, or update tests accordingly.
4. **Economic calendar auto-feature** (non-slash) stays; only its error-copy changes.
