#!/usr/bin/env bash
set -euo pipefail

: "${JFX_KEY:?Set JFX_KEY before running this script}"
JFX_BASE="${JFX_BASE:-https://lwlikhjgwazyrahucatl.supabase.co/functions/v1/jfx-api}"
JFX_CTRADER_TRADE_URL="${JFX_CTRADER_TRADE_URL:-https://jfxjournal.site/api/ctrader/trade}"

echo "== Journal: latest trade =="
curl --fail-with-body --silent --show-error \
  -H "X-API-Key: ${JFX_KEY}" \
  "${JFX_BASE}/v1/trades?limit=1"
echo

echo "== cTrader: open positions (demo) =="
curl --fail-with-body --silent --show-error \
  -H "X-API-Key: ${JFX_KEY}" -H "Content-Type: application/json" \
  -d '{"action":"get_positions","isDemo":true}' \
  "${JFX_CTRADER_TRADE_URL}"
echo
