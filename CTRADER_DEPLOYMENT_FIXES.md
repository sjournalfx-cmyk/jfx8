# cTrader Deployment Fixes

This document records the cTrader OAuth and deployment issues diagnosed and fixed during the production rollout.

## 1. OAuth token exchange returned HTTP 500 after deployment

### Symptom

After cTrader redirected back to the application, the UI showed:

```text
cTrader Auth Failed
Token exchange failed: HTTP 500
```

### Cause

The Vite development server had access to local `.env` values and its own middleware. Vercel runs the `/api/ctrader/*` files as separate serverless functions, so those local values are not automatically available in production.

The token exchange function required the cTrader app credentials at runtime:

- `CTRADER_CLIENT_ID`
- `CTRADER_CLIENT_SECRET`

The cTrader callback URL also has to match the URL registered in the cTrader Open API application exactly.

### Fix

The exchange endpoint was moved to server-side credential lookup and now supports the existing `VITE_CTRADER_*` names as a compatibility fallback while deployments migrate to the safer `CTRADER_*` names. The client secret should ultimately exist only as `CTRADER_CLIENT_SECRET`.

The production callback URL was documented as:

```text
https://www.jfxjournal.site/api/ctrader/callback
```

The cTrader Open API portal must contain the exact callback URL used by the production site.

## 2. Stale browser tabs failed to load `ChartGrid` after a deployment

### Symptom

Browsers showed errors such as:

```text
Failed to fetch dynamically imported module:
https://www.jfxjournal.site/assets/ChartGrid-D6bhCBFs.js
```

### Cause

Vite gives code-split files content hashes. An already-open browser tab can keep an old `index` bundle that references a chunk from a previous deployment. Once that old chunk is removed, the dynamic import receives a 404.

### Fix

`lib/safeLazy.ts` wraps all React lazy imports. When a chunk-loading error occurs it now:

1. Sets a one-time session guard.
2. Navigates to a cache-busted URL using `jfx_chunk_reload=<timestamp>`.
3. Forces the browser to obtain the current `index.html` and current chunk hashes.
4. Clears the session guard after a successful lazy import so later deployments can recover normally.

This prevents stale tabs from remaining on the error boundary indefinitely.

## 3. Vercel functions returned `FUNCTION_INVOCATION_FAILED`

### Symptom

Directly requesting the production endpoint returned:

```text
HTTP 500 Internal Server Error
X-Vercel-Error: FUNCTION_INVOCATION_FAILED
A server error has occurred
```

The callback route worked, but `/api/ctrader/exchange`, `/api/ctrader/refresh`, and `/api/ctrader/accounts` failed before returning their own JSON responses.

### Cause

The cTrader functions imported the shared `api/_lib/cors` helper. In the deployed Vercel function bundle, that startup dependency failed, so the function crashed before its handler ran.

### Fix

The cTrader routes were made dependency-free at startup by removing the shared CORS helper import from:

- `api/ctrader/exchange.ts`
- `api/ctrader/refresh.ts`
- `api/ctrader/accounts.ts`
- `api/ctrader/logout.ts`

These endpoints are called by the same-origin SPA, so cross-origin CORS handling is not required for the cTrader flow. Removing the failing startup dependency allows Vercel to initialize the functions and return useful JSON errors when a real configuration or upstream problem occurs.

## 4. Authentication succeeded but account loading returned HTTP 500

### Symptom

The UI showed successful cTrader authentication, followed by:

```text
Could not load accounts
cTrader OAuth credentials not configured
```

The browser request was:

```text
GET /api/ctrader/accounts 500
```

### Cause

The exchange route had already been updated to read both `CTRADER_*` and legacy `VITE_CTRADER_*` variables. The accounts and refresh routes still read only `CTRADER_*`, so they could not see the same credentials that allowed the exchange to succeed.

### Fix

The accounts and refresh routes now use the same credential lookup as the exchange route. They also return HTTP 503 with a clear `missing` list when deployment configuration is absent, instead of masking configuration problems as generic HTTP 500 errors.

## 5. Deployment and Git workflow

The fixes were committed and pushed to both configured remotes:

- `origin`
- `vercel-repo`

The final cTrader account-credential fix is commit:

```text
babd66d86f21d132da3481dce93488fb1a1b1494
```

For a precise Vercel deployment, use that commit SHA in **Deployments → Create Deployment**, wait for the preview build to finish, and promote it to production. Deploying the `main` branch is also valid once it points to this commit.

## 6. Required Vercel configuration

In the Vercel project, configure these variables for the **Production** environment:

```text
CTRADER_CLIENT_ID=<cTrader Open API client ID>
CTRADER_CLIENT_SECRET=<cTrader Open API client secret>
```

The legacy `VITE_CTRADER_CLIENT_ID` and `VITE_CTRADER_CLIENT_SECRET` names are supported temporarily for compatibility, but the secret should be migrated to the unprefixed server-only variable and rotated afterward.

After changing environment variables, create a new deployment. Environment-variable changes do not retroactively change an existing deployment.

## 7. Verification checklist

After promoting the deployment:

1. Open the production site in a fresh tab or use `Ctrl+Shift+R`.
2. Connect cTrader and confirm the success banner appears.
3. Confirm the account list loads after authentication.
4. Check that no request to `/api/ctrader/exchange`, `/api/ctrader/accounts`, or `/api/ctrader/refresh` returns HTTP 500.
5. If a credential is missing, expect a structured configuration error identifying the missing variable.

The final working flow is: cTrader authorization → callback redirect → server-side token exchange → httpOnly refresh cookie → account lookup through the cTrader WebSocket API.
