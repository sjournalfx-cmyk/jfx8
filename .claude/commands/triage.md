---
description: Sort incoming bug reports and feedback: fix the clear ones, escalate the rest
---

Collect new feedback from: $ARGUMENTS (e.g. pasted messages, screenshots, Sentry errors, Vercel runtime errors, GitHub issues).

For each item decide:
- CLEAR BUG (reproducible, obvious expected behaviour, e.g. a button that does nothing, a crash, a failing payment/trade call): reproduce it, write a failing test, fix, `npm run gate`, note the fix.
- NEEDS OWNER (confusion, feature request, anything touching pricing, data deletion, trading behaviour, or the PRD): write a one-paragraph summary + your recommendation; do not change code.
- NOISE / DUPLICATE: say why.

Output a table: item | category | action taken | time from report to fix.
