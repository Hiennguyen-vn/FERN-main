#!/usr/bin/env bash
# Render + apply FERN Phase 1 K8s HA manifests for all services.
# Usage:
#   ./install.sh [namespace]            # default namespace=fern
#   ./install.sh --dry-run               # render to stdout, don't apply
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NS="${1:-fern}"
DRY_RUN="${DRY_RUN:-false}"
[[ "${1:-}" == "--dry-run" ]] && { DRY_RUN=true; NS="fern"; }

SERVICES=(
  master-node auth-service org-service hr-service product-service
  procurement-service sales-service inventory-service payroll-service
  finance-service audit-service report-service gateway
)

for svc in "${SERVICES[@]}"; do
  values_file="${SCRIPT_DIR}/values/${svc}.yaml"
  if [[ ! -f "$values_file" ]]; then
    # Fall back to default values + override serviceName via --set
    overrides="--set serviceName=${svc}"
  else
    overrides="-f ${values_file}"
  fi
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "--- ${svc} ---"
    helm template "$svc" "${SCRIPT_DIR}/fern-service" $overrides --namespace "$NS"
  else
    helm upgrade --install "$svc" "${SCRIPT_DIR}/fern-service" \
      $overrides --namespace "$NS" --create-namespace --wait --timeout 5m
  fi
done
