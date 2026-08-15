---
name: jfx-journal
description: Use the JFX Journal API to answer questions about the user's private trades, notes, analytics, and trading bridge.
---

# JFX Journal API

Use this skill when the user asks about their JFX Journal data. The API key is in the `JFX_KEY` environment variable. Never reveal the key, include it in an answer, write it to source control, or put it in a URL.

## Authentication

Base URL: `https://lwlikhjgwazyrahucatl.supabase.co/functions/v1/jfx-api`

Every request must include `X-API-Key: $JFX_KEY`. Use only endpoints allowed by the key's scopes. Do not bypass a `403 insufficient_scope` response.

## Common requests

```bash
# User's most recent trade
curl -sS -H "X-API-Key: $JFX_KEY" "${JFX_BASE:-https://lwlikhjgwazyrahucatl.supabase.co/functions/v1/jfx-api}/v1/trades?limit=1"

# Recent trades
curl -sS -H "X-API-Key: $JFX_KEY" "${JFX_BASE:-https://lwlikhjgwazyrahucatl.supabase.co/functions/v1/jfx-api}/v1/trades?limit=20"

# Trading summary
curl -sS -H "X-API-Key: $JFX_KEY" "${JFX_BASE:-https://lwlikhjgwazyrahucatl.supabase.co/functions/v1/jfx-api}/v1/analytics/summary"

# Notes
curl -sS -H "X-API-Key: $JFX_KEY" "${JFX_BASE:-https://lwlikhjgwazyrahucatl.supabase.co/functions/v1/jfx-api}/v1/notes?limit=20"
```

## Response behavior

Parse the JSON response and answer from the returned data. Never invent missing trades or metrics. Explain these responses plainly:

- `401`: missing, malformed, expired, or revoked key
- `403`: the key does not have the required scope
- `404`: the requested resource does not exist
- `429`: the API rate limit was reached; retry after the indicated delay

When the user asks “What was my last trade?”, call `GET /v1/trades?limit=1`, inspect the returned record, and summarize the pair, direction, entry/exit, result, P&L, and date when available.
