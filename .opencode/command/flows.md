---
description: Run the critical user flows end to end (error-free sessions)
---

Run every flow in `specs/FLOWS.md` against $ARGUMENTS (default http://localhost:3000; start `npm run dev` if needed) using the Playwright MCP browser tools.

- Use the test account from `.env.test.local` (E2E_EMAIL / E2E_PASSWORD, gitignored) or demo mode. Never a real user's account, never live trading.
- For each flow record: passed, seconds, failed_step, console errors, failed network requests.
- Run desktop (1440×900) and mobile (390×844) for F2, F5, F9.
- Write `reports/flows.json` in the format described in FLOWS.md and print the error-free-session rate (passed flows / total).

If a flow fails because of a real bug, say which file is most likely responsible. Do not fix code in this command unless the owner asks.
