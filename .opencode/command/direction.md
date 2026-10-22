---
description: Drift check: does recent work still match specs/PRD.md?
---

Check whether the app is drifting away from the plan.

Scope: $ARGUMENTS (default: commits since the last tag, or the last 20 commits, plus uncommitted changes).

1. Read `specs/PRD.md`, `specs/features.json`, `specs/FLOWS.md`.
2. Get the change set: `git log --oneline -20`, `git diff --stat HEAD~20`, `git status`.
3. For EACH section of the PRD (core jobs 1-8, non-negotiables, out-of-scope) launch a
   separate subagent (Task tool) that reads the relevant changed files and answers:
   does this work serve the section, contradict it, or is it unrelated?
4. Yourself: list every change that maps to NO section of the PRD (that is drift),
   and every entry in `specs/features.json` whose code changed.
5. Run `npm run guard`.

Report (write it to `reports/direction.md` too):
- Verdict: ON COURSE / DRIFTING / OFF COURSE
- Scorecard table: PRD section | changes touching it | aligned? | score 0-5
- Drift list: change → why it's drift → recommend KEEP (owner updates PRD) or REMOVE
- Features at risk (changed + not covered by tests)
- Next actions checklist

Do not change any code in this command. Report only.
