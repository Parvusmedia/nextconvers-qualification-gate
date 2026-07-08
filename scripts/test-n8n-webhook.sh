#!/usr/bin/env bash
# Test live n8n webhook (after workflow import + activation).
set -euo pipefail
WEBHOOK_URL="${WEBHOOK_URL:-https://pmedia.app.n8n.cloud/webhook/qualification-gate}"
PAYLOAD="${1:-tests/sample-payloads/nextconvers-sample-payload.json}"
echo "POST $WEBHOOK_URL"
curl -s -X POST "$WEBHOOK_URL" -H "Content-Type: application/json" -d @"$PAYLOAD" | jq .
