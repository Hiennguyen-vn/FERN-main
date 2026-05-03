#!/usr/bin/env bash
# Fetch FERN backend OpenAPI spec + regenerate TypeScript types for PWA + agent.
#
# Prerequisite: FERN backend exposes /v3/api-docs via springdoc-openapi on each service.
# If not available yet, this script falls back to checking in a hand-maintained spec under contracts/.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

FERN_GATEWAY_URL="${FERN_GATEWAY_URL:-http://localhost:8080}"
CONTRACTS_DIR="$REPO_ROOT/contracts"
PWA_TYPES="$REPO_ROOT/src/api/types.generated.ts"
AGENT_TYPES="$REPO_ROOT/agent/src/upstream/types.generated.ts"

mkdir -p "$CONTRACTS_DIR"

echo "Fetching OpenAPI spec from $FERN_GATEWAY_URL …"
for svc in sales auth product inventory; do
  url="$FERN_GATEWAY_URL/api/v1/$svc/v3/api-docs"
  out="$CONTRACTS_DIR/${svc}.openapi.json"
  if curl -fsSL "$url" -o "$out.tmp" 2>/dev/null; then
    mv "$out.tmp" "$out"
    echo "  ✓ $svc"
  else
    echo "  ✗ $svc (upstream not reachable — keeping existing $out if present)"
    rm -f "$out.tmp"
  fi
done

if ! command -v npx >/dev/null; then
  echo "npx not found — install Node.js first"; exit 1
fi

merged="$CONTRACTS_DIR/fern.openapi.json"
first="$(ls "$CONTRACTS_DIR"/*.openapi.json 2>/dev/null | head -n1 || true)"
if [ -z "$first" ]; then
  echo "No spec files found under $CONTRACTS_DIR — nothing to generate"; exit 0
fi

# For MVP just pick the sales spec (expand to a proper merge later).
cp "$CONTRACTS_DIR/sales.openapi.json" "$merged" 2>/dev/null || cp "$first" "$merged"

echo "Generating PWA types → $PWA_TYPES"
npx --yes openapi-typescript@7 "$merged" -o "$PWA_TYPES"

echo "Generating agent upstream types → $AGENT_TYPES"
mkdir -p "$(dirname "$AGENT_TYPES")"
npx --yes openapi-typescript@7 "$merged" -o "$AGENT_TYPES"

echo "Done. Review diff and commit both generated files + contracts/*.openapi.json."
