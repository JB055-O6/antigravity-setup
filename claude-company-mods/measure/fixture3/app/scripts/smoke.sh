#!/usr/bin/env bash
# Smoke test against a running shop: health, products, one checkout, its summary.
set -euo pipefail
BASE=${1:-http://localhost:8080}
curl -fsS "$BASE/healthz" >/dev/null
curl -fsS "$BASE/api/products" | python3 -c 'import json, sys; assert json.load(sys.stdin)'
ORDER=$(curl -fsS -X POST "$BASE/api/checkout" -H 'Content-Type: application/json' \
  -d '{"items": [{"sku": "TEA-001", "qty": 1}], "customer": {"id": "smoke", "postcode": "10001"}}')
ID=$(echo "$ORDER" | python3 -c 'import json, sys; print(json.load(sys.stdin)["id"])')
curl -fsS "$BASE/api/orders/$ID/summary" >/dev/null
echo "smoke ok: $ID"
