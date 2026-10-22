# Critical user flows (error-free sessions)

Run by `/flows` before every deploy. Each flow must complete start to finish with
no console errors, no failed network calls (except expected 401s on signed-out
pages) and no step slower than 5 s. Results go to `reports/flows.json`:
`{ "at": ISO, "base_url": ..., "flows": [{ "id", "passed", "seconds", "failed_step", "console_errors": [], "notes" }] }`.

Use a local dev server (`npm run dev`) or a Vercel preview URL with a **test
account** — never a real user's account, never live trading. Demo mode is fine
for read-only flows.

| id | Flow | Steps | Pass when |
|---|---|---|---|
| F1 | Landing → sign up / sign in | open `/`, open auth, sign in with test account | lands on Dashboard, no errors |
| F2 | Log a manual trade | Log Trade → steps 1-3 → save | trade appears in Journal/History with correct P&L and direction |
| F3 | Quick Log | open Quick Log modal, save | trade appears; modal closes |
| F4 | Edit + delete + restore a trade | Journal → edit field → delete → undo/restore | each change persists after reload |
| F5 | Dashboard + Analytics load | open Dashboard, then Analytics; switch period | all widgets render numbers, no NaN/blank cards |
| F6 | Portfolios | create portfolio, switch to it, assign trade, switch back | stats change per portfolio, nothing lost |
| F7 | Rules & trading locks | add a lock rule, try a blocked action | blocked with clear message; unlock cooldown shown |
| F8 | Notebook | create note, edit, reload, delete | persists across reload |
| F9 | AI Assistant | ask "show my win rate, P&L and profit factor as cards" | streamed answer renders cards (OpenUI) or clean text fallback |
| F10 | Charts / Backtest Lab | open Market Grid, change symbol/timeframe; open Backtest Lab, start a session | candles render; no endless spinner |
| F11 | Connect & Import | open page, start CSV import with sample file | trades imported, duplicates not created |
| F12 | Settings | toggle theme, open API keys panel | theme persists after reload; panel loads |
| F13 | Mobile layout | repeat F2, F5, F9 at 390×844 viewport | same results, no horizontal overflow |
