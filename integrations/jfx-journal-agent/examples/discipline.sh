#!/usr/bin/env bash
set -euo pipefail

# Read-only smoke test for the discipline scopes:
# calendar, checklists, trading locks, and account summary.
: "${JFX_KEY:?Set JFX_KEY before running this script}"
JFX_BASE="${JFX_BASE:-https://lwlikhjgwazyrahucatl.supabase.co/functions/v1/jfx-api}"
JFX_CTRADER_TRADE_URL="${JFX_CTRADER_TRADE_URL:-https://www.jfxjournal.site/api/ctrader/trade}"

echo "== Journal: economic calendar (requires calendar:read) =="
curl --fail-with-body --silent --show-error \
  -H "X-API-Key: ${JFX_KEY}" \
  "${JFX_BASE}/v1/calendar"
echo

echo "== Journal: checklists (requires checklists:read) =="
curl --fail-with-body --silent --show-error \
  -H "X-API-Key: ${JFX_KEY}" \
  "${JFX_BASE}/v1/checklists"
echo

echo "== Journal: trading locks (requires locks:read) =="
curl --fail-with-body --silent --show-error \
  -H "X-API-Key: ${JFX_KEY}" \
  "${JFX_BASE}/v1/locks"
echo

echo "== cTrader: balance & equity (requires account:read) =="
curl --fail-with-body --silent --show-error \
  -H "X-API-Key: ${JFX_KEY}" -H "Content-Type: application/json" \
  -d '{"action":"account_summary"}' \
  "${JFX_CTRADER_TRADE_URL}"
echo
