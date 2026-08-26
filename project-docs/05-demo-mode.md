# 05 — Demo Mode

A reversible demo journal for first-time users: realistic sample data, fully
read-only, zero leakage in either direction.

## Design rules

1. **Reversible** — one flag flips the whole app; real data untouched.
2. **Read-only** — every mutation blocked with an info toast; destructive
   affordances hidden rather than merely disabled.
3. **Isolated** — demo never reads real user data; real state never polluted
   by demo actions.
4. **Alive** — sample window always covers a recent ~3 months so analytics
   look meaningful.

## State model

- Flag: `isDemoMode` (localStorage `jfx_demo_mode`), owned by `App.tsx`.
- Overlay pattern (App.tsx): views only ever see `active*` props —
  `activeUserProfile/Trades/Notes/DailyBias/EaSession` swap to demo versions
  when the flag is on. Views never read raw state.
- Sample data: `lib/demoData.ts`
  - 18 trades (`demoTrades`) on a fixed Jan–Mar template shifted at module
    load by `DATE_OFFSET_DAYS` so it ends at the most recent completed March.
    Helpers: `shiftedDate()` (date-only) and `shiftedTimestamp()` (ISO with
    time/tz preserved).
  - `demoNotes`, `demoDailyBias`, `demoEASession`, and
    `getDemoProfile(baseProfile)` overlay.

### Demo profile honesty

`getDemoProfile` sets `eaConnected: false`, `syncKey: 'demo-no-sync'`,
`autoJournal: false`, `syncMethod: 'MANUAL'` (falls back to base profile's
experience/style/theme). The demo account must NEVER claim a live bridge.

## Entry points

1. **Auto:** onboarded user with zero trades and no stored flag → auto-enabled.
2. **Sidebar pill:** "Try Demo" / "Exit Demo" under the avatar (single source;
   the avatar itself is not clickable).
3. **Onboarding:** "Explore with Demo Data" on the final step — writes
   `jfx_demo_mode='true'`, completes a minimal placeholder profile
   ('Demo Trader', FREE tier), lands on Dashboard.

## Guard rails (where mutations are blocked)

| Layer | Mechanism |
|---|---|
| App handlers | `blockDemoAction(title)` early-return in every mutating handler (add/update/delete/import/edit/bias/cash…) |
| EASetup callbacks | `onTradeAdded` / `onAddOffline` guarded inline |
| Offline queue | `addToOfflineQueue` checks localStorage flag directly (hook can't see React state) |
| Connect & Import | Method-choice screen forced; Desktop Bridge card hidden; bridge resume/wizard completion disabled |
| Journal | Row edit button + selection checkboxes hidden in demo |
| Notes | Read-only branches around add/update/delete |
| Daily Bias widget | Clicks toast instead of cycling |

Badges shown in Dashboard, Journal, Analytics headers when active.

## Auto-enable effect (App.tsx)

```ts
if (isAuthenticated && userProfile?.onboarded && trades.length === 0
    && localStorage.getItem('jfx_demo_mode') === null) {
  setIsDemoMode(true);
}
```
Runs once per session; explicit stored value always wins.

## Exit behavior

Sidebar pill or banner button → flag off → all `active*` revert to real state.
Real journal is untouched (possibly empty). No cleanup needed.

## Pitfalls to avoid

- Never give demo profile a real-looking `syncKey` or `eaConnected: true`.
- Any NEW mutation handler must call `blockDemoAction()` first.
- Any new view should render the amber "Demo Mode" badge and use `active*` props only.
- Sample-data dates must go through `shiftedDate/shiftedTimestamp` — hard-coded dates rot.
