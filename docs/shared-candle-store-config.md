## Critical gotchas learned (do not regress!)

1. **cTrader rotates refresh tokens on EVERY mint.** The old token is
   invalid the moment a new one is issued. The harvester MUST persist the
   rotated token (it saves to service_config after each mint). If you ever
   mint a token manually for testing, update service_config or re-do OAuth,
   otherwise the next run fails with ACCESS_DENIED.

2. **package.json has "type": "module"** so Vercel compiles api/*.ts to
   native ESM. Consequences:
   - Relative imports need explicit `.js` extensions (`from './_lib/cors.js'`)
   - `.mjs` files can't be imported from bundled TS — use `.js`
   - The `ws` package needs `"functions": { "api/**/*.ts": { "includeFiles":
     "node_modules/ws/**" } }` in vercel.json or it crashes at runtime with
     "Dynamic require of events is not supported"

3. **Vercel Hobby limits:** max 12 serverless functions (count files under
   api/), daily-only crons. Removing an unused endpoint freed a slot; the
   external cron-job.org pinger replaces frequent scheduling.

4. **Vite dev middleware cannot dynamically import() TS files** ("Vite
   module runner has been closed"). That's why pure helpers live in
   `harvestCore.js` and dev has its own `harvesterNet.mjs`. Static imports
   at config top-level are fine.

5. **Git author must match the Vercel-linked GitHub account** (private repo,
   Hobby = no collaborators). Configured: sjournalfx-cmyk <sjournalfx@gmail.com>.

6. **cTrader price fields are integers scaled by 10^5 regardless of symbol
   digits.** digits only controls display rounding — see decodeTrendbars in
   harvestCore.js.
