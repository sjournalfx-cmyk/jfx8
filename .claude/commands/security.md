---
description: Security pass on recent changes (deepsec + manual review)
---

Security review of: $ARGUMENTS (default: `git diff main...HEAD` plus uncommitted changes; use `git diff HEAD~10` if on main).

1. If `.deepsec/` exists run `cd .deepsec && pnpm deepsec scan` (free, regex only) and include its candidates. Do NOT run paid AI processing without the owner's OK. If it doesn't exist, tell the owner `npx deepsec init` can set it up (it asks for a model/key).
2. Run `npm audit --omit=dev` and report high/critical only.
3. Manually check the changed code for: secrets or service-role keys reaching the client (`VITE_*` vars, bundled code), missing auth checks in `api/**`, Supabase RLS gaps or tables without grants in `supabase/migrations`, unvalidated input reaching SQL/HTML (`dangerouslySetInnerHTML` without `lib/htmlSanitizer.ts`), CORS `*` on authenticated routes, missing rate limits, trading endpoints without idempotency/locks, tokens in logs.
4. Report: severity | file:line | issue | fix. Fix Critical/High only with the owner's OK, then run `npm run gate`.
