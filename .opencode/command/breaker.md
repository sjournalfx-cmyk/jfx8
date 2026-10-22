---
description: Launch the breaker agent to try to break the app on purpose
---

Use the `breaker` subagent on: $ARGUMENTS (default: everything changed since the last commit on main, plus the critical paths in AGENTS.md §3).

When it reports back:
1. Show the findings table to the owner.
2. For each Critical/High finding: write a failing test that reproduces it FIRST, then fix the code, then run `npm run gate`.
3. Re-run the breaker on the same area to confirm the holes stay closed. Loop at most 3 times, then report what's left.
