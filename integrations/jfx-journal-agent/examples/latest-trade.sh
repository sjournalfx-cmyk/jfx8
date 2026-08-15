#!/usr/bin/env bash
set -euo pipefail

: "${JFX_KEY:?Set JFX_KEY before running this script}"
JFX_BASE="${JFX_BASE:-https://lwlikhjgwazyrahucatl.supabase.co/functions/v1/jfx-api}"

curl --fail-with-body --silent --show-error \
  -H "X-API-Key: ${JFX_KEY}" \
  "${JFX_BASE}/v1/trades?limit=1"
