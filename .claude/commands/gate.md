---
description: Run the full quality gate and fix whatever fails
---

Run `npm run gate` from the repo root.

If it fails:
1. Read the failing step's output and find the real cause.
2. Fix the CODE. Never delete, skip or loosen a test, never edit `specs/features.json`
   to remove an entry, never add `// @ts-ignore` / `any` just to pass.
3. Only touch files related to the failure; leave other people's uncommitted work alone (`git status`).
4. Re-run `npm run gate` until it passes.

Finish with the summary from `reports/gate.json` and a list of files you changed. $ARGUMENTS
