#!/usr/bin/env bash
# ============================================================================
# run_sprints.sh — FERN AI Query Agent eval sprint runner
#
# Usage:
#   ./scripts/run_sprints.sh sprint1           # shadow eval (requires OPENAI_API_KEY)
#   ./scripts/run_sprints.sh sprint2           # local eval after backfill L4 cases
#   ./scripts/run_sprints.sh sprint3           # full eval (requires RUN_GOLDEN=1 + ClickHouse)
#   ./scripts/run_sprints.sh gates             # check G1-G5, auto-retire if all pass
#   ./scripts/run_sprints.sh all               # run sprint1 → gates in sequence
#   ./scripts/run_sprints.sh local             # fast CI mode (no API key needed)
#
# Prerequisites:
#   Sprint 1+: OPENAI_API_KEY=sk-...   (real key)
#   Sprint 3:  CLICKHOUSE_HOST + RUN_GOLDEN=1
#   Auto-retire: CONFIRM_RETIRE=1
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
EVALS_DIR="$ROOT/evals"
DATE_TAG="$(date +%F)"

# macOS often has only `python3`; many dev setups use a project venv.
if [[ -n "${PYTHON:-}" ]]; then
  if ! command -v "$PYTHON" >/dev/null 2>&1 && [[ ! -x "$PYTHON" ]]; then
    err "PYTHON is set to \"$PYTHON\" but that executable was not found."
    exit 1
  fi
elif [[ -x "$ROOT/.venv/bin/python" ]]; then
  PYTHON="$ROOT/.venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  PYTHON=python3
elif command -v python >/dev/null 2>&1; then
  PYTHON=python
else
  err "No Python found in PATH (tried: $ROOT/.venv/bin/python, python3, python)."
  echo "  Install Python 3 or run:  export PYTHON=/path/to/python3"
  exit 1
fi

# ── colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
err()  { echo -e "${RED}✗${NC} $*" >&2; }
head_() { echo -e "\n${BOLD}${CYAN}══ $* ══${NC}"; }

# ── guard helpers ─────────────────────────────────────────────────────────────
require_openai() {
  if [[ -z "${OPENAI_API_KEY:-}" || "${OPENAI_API_KEY:-}" == sk-...* ]]; then
    err "OPENAI_API_KEY is not set (or still the placeholder sk-...)."
    echo   "  Set it and re-run:"
    echo   "    export OPENAI_API_KEY=sk-<your-real-key>"
    echo   "    AGENT_MODE_ENABLED=true ./scripts/run_sprints.sh sprint1"
    exit 1
  fi
}

require_clickhouse() {
  if [[ "${RUN_GOLDEN:-}" != "1" ]]; then
    err "Sprint 3 requires RUN_GOLDEN=1 and a seeded ClickHouse."
    echo   "  Seed first:  $PYTHON scripts/seed_eval_fixtures.py"
    echo   "  Then run:    RUN_GOLDEN=1 AGENT_MODE_ENABLED=true ./scripts/run_sprints.sh sprint3"
    exit 1
  fi
}

# ── sprint functions ──────────────────────────────────────────────────────────
run_local() {
  head_ "LOCAL (CI gate — no OpenAI, no ClickHouse)"
  OUT="$EVALS_DIR/local-${DATE_TAG}.jsonl"
  cd "$ROOT"
  $PYTHON -m scripts.run_openai_evals \
    --mode local \
    --min-pass-rate 0.95 \
    --out "$OUT" \
    "$@"
  ok "local eval OK → $OUT"
}

run_shadow_mock() {
  head_ "SHADOW-MOCK — full graph, deterministic mock LLM (no API key)"
  OUT="$EVALS_DIR/shadow-mock-${DATE_TAG}.jsonl"
  cd "$ROOT"
  $PYTHON -m scripts.run_openai_evals \
    --mode shadow-mock \
    --min-pass-rate 0.85 \
    --out "$OUT" \
    "$@"
  ok "shadow-mock eval → $OUT"
}

run_sprint1() {
  head_ "SPRINT 1 — shadow (real OpenAI, stubbed ClickHouse)"
  require_openai
  OUT="$EVALS_DIR/shadow-${DATE_TAG}.jsonl"
  cd "$ROOT"
  AGENT_MODE_ENABLED=true \
  $PYTHON -m scripts.run_openai_evals \
    --mode shadow \
    --min-pass-rate 0.85 \
    --out "$OUT" \
    "$@"
  SHADOW_RATE=$("$PYTHON" -c "
import json, sys
data = [json.loads(l) for l in open('$OUT') if l.strip()]
results = [d for d in data if d.get('type')=='result']
if results:
    passed = sum(1 for r in results if r.get('passed'))
    print(f'{passed/len(results):.3f}')
else:
    print('0.0')
" 2>/dev/null || echo "0.0")
  echo "SHADOW_PASS_RATE=$SHADOW_RATE" >> "$EVALS_DIR/.gate_state"
  ok "Sprint 1 shadow eval → $OUT  (pass-rate $SHADOW_RATE)"
}

run_sprint2() {
  head_ "SPRINT 2 — local eval after L4 codegen backfill"
  OUT="$EVALS_DIR/sprint2-${DATE_TAG}.jsonl"
  cd "$ROOT"
  $PYTHON -m scripts.run_openai_evals \
    --mode local \
    --min-pass-rate 0.95 \
    --out "$OUT" \
    "$@"
  ok "Sprint 2 local eval → $OUT"
  echo ""
  echo "  Next: run shadow on L4 codegen cases when API key is ready:"
  echo "    AGENT_MODE_ENABLED=true ./scripts/run_sprints.sh sprint1 --tag L4"
}

run_sprint3() {
  head_ "SPRINT 3 — full e2e (real OpenAI + ClickHouse seeded)"
  require_openai
  require_clickhouse
  OUT="$EVALS_DIR/full-${DATE_TAG}.jsonl"
  cd "$ROOT"
  RUN_GOLDEN=1 \
  AGENT_MODE_ENABLED=true \
  $PYTHON -m scripts.run_openai_evals \
    --mode full \
    --min-pass-rate 0.85 \
    --out "$OUT" \
    "$@"
  FULL_RATE=$("$PYTHON" -c "
import json
data = [json.loads(l) for l in open('$OUT') if l.strip()]
results = [d for d in data if d.get('type')=='result']
if results:
    passed = sum(1 for r in results if r.get('passed'))
    print(f'{passed/len(results):.3f}')
else:
    print('0.0')
" 2>/dev/null || echo "0.0")
  echo "FULL_PASS_RATE=$FULL_RATE" >> "$EVALS_DIR/.gate_state"
  ok "Sprint 3 full eval → $OUT  (pass-rate $FULL_RATE)"
}

check_gates() {
  head_ "GATE CHECK (G1-G5)"
  cd "$ROOT"
  $PYTHON scripts/check_gates.py "$@"
}

cmd="${1:-help}"
shift || true

case "$cmd" in
  local)        run_local "$@" ;;
  shadow-mock)  run_shadow_mock "$@" ;;
  sprint1)      run_sprint1 "$@" ;;
  sprint2)      run_sprint2 "$@" ;;
  sprint3)      run_sprint3 "$@" ;;
  gates)        check_gates "$@" ;;
  all)
    run_local "$@"
    run_shadow_mock "$@"
    run_sprint1 "$@"
    run_sprint2 "$@"
    run_sprint3 "$@"
    check_gates "$@"
    ;;
  *)
    echo "Usage: run_sprints.sh {local|shadow-mock|sprint1|sprint2|sprint3|gates|all} [--tag TAG] [--case ID]"
    echo ""
    echo "  local        CI gate (no network, <1s)."
    echo "  shadow-mock  Full graph, deterministic LLM mock. No API key needed."
    echo "  sprint1      Shadow mode: real OpenAI, stubbed DB. Needs OPENAI_API_KEY."
    echo "  sprint2      Local eval after L4 codegen backfill."
    echo "  sprint3      Full e2e. Needs RUN_GOLDEN=1 + seeded ClickHouse."
    echo "  gates        Check G1-G5 gates. Auto-retire if CONFIRM_RETIRE=1."
    echo "  all          Run shadow-mock → sprint1 → sprint3 → gates."
    exit 0
    ;;
esac
