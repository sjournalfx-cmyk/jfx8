---
description: Launch the first-time-user agent to find where new traders get stuck
---

Make sure a dev server is running (`npm run dev -- --host 0.0.0.0`, default http://localhost:3000) or use the preview URL in $ARGUMENTS.

Then use the `first-time-user` subagent. Give it ONLY the URL and the goal
"you are a new trader who just heard about this journal; sign up/try demo, log your first trade, understand your stats, set a rule, ask the AI something".
Do not give it any knowledge of the code.

When it reports, turn each friction point into a concrete UI fix proposal (file + change) ranked by impact. Ask the owner before implementing anything that changes copy or flow significantly.
