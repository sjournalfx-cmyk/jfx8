# Plan: Restyle jfx8 analytics widgets to match jfx-mobile card style

## Goal

Make every widget rendered in the jfx8 (`~/Downloads/jfx8`) Analytics tab look like its
jfx-mobile (`~/Downloads/jfx-mobile`) counterpart: dark-grey background, no borders, no
decorative label icons.

## Current context / assumptions

- Target repo: `~/Downloads/jfx8`, dev server runs with `npm run dev` → http://127.0.0.1:3000/.
  Reference repo (read-only, DO NOT EDIT): `~/Downloads/jfx-mobile`.
- The mobile card style was verified by direct file comparison (same widget, both repos):
  - Shell: `bg-[#0a0a0a] text-white rounded-[14px] p-6 border-0 flex flex-col pt-[20px]`
    (mobile `PLByMindsetWidget.tsx:37` vs jfx8 `... border border-[#1f1f1f]`
    `bg-[#000000] ... shadow-[0_1px_2px_rgba(0,0,0,0.35)]`).
  - Title: `text-[15px] font-semibold tracking-tight text-left text-white`
    (mobile) vs `text-[18px] font-bold text-white` (jfx8).
  - Stat-card labels: plain text, e.g. `<span>Win Rate</span>` (mobile
    `Analytics.tsx:715`); jfx8 has decorative icons before labels, e.g.
    `<span className="flex items-center gap-2"><Target size={14}
    className="text-indigo-500" /> Win Rate</span>`.
  - Stat-card shell: `h-full p-6 rounded-[24px] border-0 flex flex-col
    justify-between bg-[#0a0a0a] text-white` (mobile `Analytics.tsx:713`).
- Mobile cards use the FIXED dark shell even in light mode (no `isDarkMode` ternary on
  card shells; mobile `Analytics.tsx:713,800`). Page background keeps its light/dark
  switch — only card shells change. Assumption: replicate exactly that.
- "No icons" means decorative label icons (`Target`, `Gauge`, `TrendingUp`,
  `TrendingDown`, `Activity`, etc. inside card headers). The `HelpCircle` + `Tooltip`
  help affordances STAY — mobile keeps them (mobile `Analytics.tsx:716`).
- The tabs bar restyle (sticky/solid) is already done and out of scope.
- Pre-existing, unrelated: `npx tsc --noEmit` reports one error in
  `lib/trade-normalization.ts(215,60)` on unmodified code. It must still be the ONLY
  error after this work.

## Architecture / proposed approach

No new components, no shared abstraction (YAGNI — ~20 files, one mechanical mapping).
For each widget file rendered by the Analytics tab, rewrite the outer card shell
className, the title className, and delete decorative label icons, copying the exact
mobile strings. Inline cards/sections in `components/Analytics.tsx` get the same
treatment. Verify by grepping for leftover border classes, then `tsc`, then a visual
check in the browser.

## Step-by-step tasks

### Task 1 — Inventory which widgets the Analytics tab actually renders (3 min)

Run (working dir `~/Downloads/jfx8`):

```bash
grep -n "^import\|from './analytics" components/Analytics.tsx | grep analytics
```

Expected: imports for `PerformanceBySession`, `ReportView`, `CurrencyStrengthMeter`,
`PairDistributionTreemapWidget`, `EquityCurveWidget`, `MomentumStreakWidget`,
`SymbolPerformanceWidget`, `DrawdownOverTimeWidget`, `StrategyPerformancePieChart`,
`TradingMistakesBarChartWidget`, `RevenueMatrixWidget`, `ComparisonView`,
`TradeGradeDistributionWidget`, `TimeAnalysisMatrixWidget`, `DetailedStatistics`,
`PLByPlanAdherenceWidget`, `CashTransactionsView`, `PLByMindsetWidget` (plus
`PsychologyAnalyzeState` helpers — not cards, skip).

Then check none of these files is ALSO rendered outside the Analytics tab:

```bash
for w in EquityCurveWidget DrawdownOverTimeWidget CurrencyStrengthMeter TradeGradeDistributionWidget SymbolPerformanceWidget PairDistributionTreemapWidget StrategyPerformancePieChart TradingMistakesBarChartWidget RevenueMatrixWidget ComparisonView DetailedStatistics ReportView PerformanceBySession TimeAnalysisMatrixWidget CashTransactionsView PLByMindsetWidget PLByPlanAdherenceWidget MomentumStreakWidget; do echo "== $w"; grep -rln "$w" --include='*.tsx' App.tsx components/ | grep -v "components/analytics/$w"; done
```

Expected: only `components/Analytics.tsx` (and its test) reference each. If a widget IS
shared with another view, convert it anyway ONLY if that view is also dark-card based;
otherwise note it in the commit message and skip that file.

### Task 2 — Apply the shell mapping to every widget file (3 min per file)

For EACH file in `components/analytics/` identified in Task 1, open it and apply these
exact replacements to the OUTER card container only (never inner content):

1. `bg-[#000000]` → `bg-[#0a0a0a]`
2. Delete the border: `border border-[#1f1f1f]` → `border-0`. If the container has a lone
   `border` token in its class list (e.g. `` `${isDarkMode ? 'bg-[#000000]
   border-zinc-800' : 'bg-white border-slate-200 shadow-md'}` ``), rewrite the whole
   ternary to the fixed mobile shell (see Task 3 for the canonical stat-card form;
   for large widget cards use `border-0 bg-[#0a0a0a] text-white` keeping that file's
   existing rounding/padding).
3. Delete shadow utilities on the card: `shadow-[0_1px_2px_rgba(0,0,0,0.35)]`,
   `shadow-md`, `shadow-sm`.
4. Ensure `text-white` is on the card container.
5. Title: `text-[18px] font-bold text-white` → `text-[15px] font-semibold
   tracking-tight text-left text-white`. (Only `h2` card titles; leave all other text.)
6. Delete decorative label icons: any lucide icon component rendered immediately before
   a card label (e.g. `<Target size={14} className="text-indigo-500" />`,
   `<Gauge .../>`, `<TrendingUp .../>`, `<TrendingDown .../>`, `<Activity .../>` inside
   the label `<span>`). If removing the icon empties the inner flex span (as in
   `<span className="flex items-center gap-2"><Target .../> Win Rate</span>`), collapse
   it to plain text: `<span>Win Rate</span>`. Then remove now-unused lucide imports from
   that file (else `tsc` with `noUnusedLocals` may fail — check `tsconfig.json`; if the
   build passes with them, still remove for cleanliness).
7. DO NOT touch: `HelpCircle`/`Tooltip`, chart colors, data logic, layout grids,
   `rounded-*`, `p-*`, psychology tone stripes (`psychologyCardToneClasses`).

Canonical before/after (from `PLByMindsetWidget.tsx:37`, verified):

```tsx
// BEFORE (jfx8)
<div className="bg-[#000000] rounded-[14px] shadow-[0_1px_2px_rgba(0,0,0,0.35)] p-6 border border-[#1f1f1f] flex flex-col pt-[20px]">
    <h2 className="text-[18px] font-bold text-white">P/L by Mindset</h2>

// AFTER (mobile style)
<div className="bg-[#0a0a0a] text-white rounded-[14px] p-6 border-0 flex flex-col pt-[20px]">
    <h2 className="text-[15px] font-semibold tracking-tight text-left text-white">P/L by Mindset</h2>
```

### Task 3 — Convert the inline cards in `components/Analytics.tsx` (10 min)

Four `renderWidget` stat cards (`winRate`, `profitFactor`, `grossProfit`, `grossLoss`,
~lines 622–657), the Total P&L + Risk/Reward cards (~lines 694–711), and the two
psychology `<section>`s (`renderPsychologyLayout`, ~lines 443, 536). Exact edits:

a) Stat cards — replace each shell (example `winRate`, repeat for all four):

```tsx
// BEFORE
<div className={`h-full p-6 rounded-[24px] border flex flex-col justify-between ${isDarkMode ? 'bg-[#000000] border-zinc-800' : 'bg-white border-slate-200 shadow-md'}`}>
    <span className="text-[10px] font-bold uppercase tracking-widest opacity-40 flex items-center justify-between w-full">
        <span className="flex items-center gap-2"><Target size={14} className="text-indigo-500" /> Win Rate</span>

// AFTER
<div className="h-full p-6 rounded-[24px] border-0 flex flex-col justify-between bg-[#0a0a0a] text-white">
    <span className="text-[10px] font-bold uppercase tracking-widest opacity-40 flex items-center justify-between w-full">
        <span>Win Rate</span>
```

b) Total P&L / Risk-Reward cards (`rounded-[20px]`, `p-5`, `text-[9px]` labels): same
   treatment — fixed `border-0 bg-[#0a0a0a] text-white` shell, drop the icon from the
   label span (keep the `Tooltip`/`HelpCircle` on the right side of the row).

c) Psychology sections — copy mobile exactly:

```tsx
// Tilt score section: BEFORE
<section className="flex min-h-[380px] flex-col rounded-[20px] border border-[#1f1f1f] bg-[#000000] px-7 py-7 shadow-[0_1px_2px_rgba(0,0,0,0.35)]">
// AFTER
<section className="flex min-h-[380px] flex-col rounded-[20px] border-0 bg-[#0a0a0a] text-white px-7 py-7">
```

```tsx
// Key Insights section: BEFORE
<section className="flex min-h-[380px] flex-col rounded-[14px] border border-[#1f1f1f] bg-[#000000] p-[18px] shadow-[0_1px_2px_rgba(0,0,0,0.35)]">
// AFTER
<section className="flex h-[380px] max-h-[380px] min-h-[380px] flex-col overflow-hidden rounded-[14px] border-0 bg-[#0a0a0a] text-white p-[18px]">
```

d) Section titles (`Tilt Score`, `Key Insights & Warnings`): `text-[18px] font-bold
   text-white` → `text-[15px] font-semibold tracking-tight text-left text-white`.

e) Remove lucide imports left unused in `Analytics.tsx` after icon deletion
   (`Target`, `Gauge`, `TrendingUp`, `TrendingDown`, `Activity`, `LineChart`,
   `Shield`, `Zap`, `Coins`, `LayoutDashboard`, `LayoutGrid` — only those with zero
   remaining usages; the tab definitions at ~line 675 still use icons for the TAB BAR,
   which stays as-is).

### Task 4 — Verify zero leftovers + typecheck (5 min)

```bash
cd ~/Downloads/jfx8
grep -rn 'border-\[#1f1f1f\]\|border-zinc-800\|bg-\[#000000\]' components/analytics/ components/Analytics.tsx | grep -v 'psychologyCardToneClasses\|toneClasses\|shell:' ; echo "leftover-count-exit=$?"
```

Expected: no output lines (grep exit 1). The `grep -v` excludes the psychology tone
system, which intentionally keeps `bg-[#000000]` shells — DO NOT change those.

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: only the known pre-existing `lib/trade-normalization.ts(215,60)` error.
Any new error = fix before continuing.

### Task 5 — Browser check + commit (5 min)

1. `npm run dev` already serves http://127.0.0.1:3000/ (restart if not running).
   The Analytics tab is behind login — sign in and scroll every tab
   (Overview / Trade Analysis / Psychology / Session / Advanced / Reports /
   Comparison / Transactions). Confirm: uniform dark-grey cards, no border lines, no
   label icons, tooltips still work.
2. Commit in `~/Downloads/jfx8` ONLY (never touch `~/Downloads/jfx-mobile`):

```bash
cd ~/Downloads/jfx8 && git add components/Analytics.tsx components/analytics/ && git status --short && git commit -m "style(analytics): match mobile card style (grey, borderless, no label icons)"
```

Expected `git status` shows only the intended files before committing.

## Tests / validation

This is a pure Tailwind className change: no logic changes, so no unit tests to write
(TDD red-green does not apply — there is no behavior to pin; inventing snapshot tests
for class strings adds brittle noise, so YAGNI says skip them). Validation per task
above is: (1) grep leftover-count is zero, (2) `tsc` shows only the pre-existing error,
(3) human visual pass over all 8 analytics tabs in the running dev server.

## Risks, tradeoffs, and open questions

- **Light mode**: mobile cards stay dark-grey even in light mode; this plan copies that
  (cards will look dark on the light `bg-[#F8FAFC]` page). If the user wants light-mode
  cards instead, the mapping needs a second variant — ASK before implementing if the
  visual check looks wrong.
- **Tab bar icons stay**: tab definitions (`Overview`, `Session`, …) keep their icons;
  only in-card decorative label icons are removed. Confirm in visual check.
- **Shared widgets**: if Task 1 finds a widget also rendered outside Analytics, changing
  its shell changes that view too. Decide per-file: convert (if that view is dark-card
  based) or skip + note in commit message.
- **Psychology tone cards** (`psychologyCardToneClasses`, colored left stripes) are
  intentionally untouched — mobile keeps the same system.
- **Existing uncommitted work**: `components/Analytics.tsx` already has uncommitted
  tabs-bar changes (sticky/solid). This plan's edits stack on the same file — commit
  together or coordinate with whoever owns that change.
- **No test coverage for styles**: regressions are only caught visually. Mitigation: the
  grep in Task 4 fails loudly if anyone reintroduces bordered shells.
