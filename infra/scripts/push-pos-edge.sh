#!/usr/bin/env bash
# push-pos-edge.sh — Build and push FERN-pos-edge to GitHub.
set -euo pipefail

POS_EDGE_DIR="${POS_EDGE_DIR:-/Users/nguyenhien/FERN-pos-edge}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }

# ── 1. Navigate to FERN-pos-edge ──────────────────────────────────────────────
if [[ ! -d "$POS_EDGE_DIR" ]]; then
  error "Directory not found: ${POS_EDGE_DIR}"
  error "Set POS_EDGE_DIR env var to the correct path."
  exit 1
fi

cd "$POS_EDGE_DIR"
info "Working in: $(pwd)"

# ── 2. Check git remote origin ────────────────────────────────────────────────
if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  error "${POS_EDGE_DIR} is not a git repository."
  exit 1
fi

if ! git remote get-url origin &>/dev/null; then
  echo ""
  echo -e "${YELLOW}════════════════════════════════════════════════════════════════════${NC}"
  echo -e "${YELLOW} No git remote 'origin' found.${NC}"
  echo -e "${YELLOW}${NC}"
  echo -e "${YELLOW} To publish FERN-pos-edge to GitHub:${NC}"
  echo -e "${YELLOW}${NC}"
  echo -e "${YELLOW}   1. Create a new repository on GitHub (e.g. FERN-pos-edge)${NC}"
  echo -e "${YELLOW}   2. Then run:${NC}"
  echo -e "${YELLOW}        git remote add origin https://github.com/<your-org>/FERN-pos-edge.git${NC}"
  echo -e "${YELLOW}        git branch -M main${NC}"
  echo -e "${YELLOW}        git push -u origin main${NC}"
  echo -e "${YELLOW}${NC}"
  echo -e "${YELLOW} Then re-run this script.${NC}"
  echo -e "${YELLOW}════════════════════════════════════════════════════════════════════${NC}"
  exit 1
fi

REMOTE_URL=$(git remote get-url origin)
info "Remote origin: ${REMOTE_URL}"

# ── 3. npm run build ──────────────────────────────────────────────────────────
if [[ ! -f "package.json" ]]; then
  warn "No package.json found in ${POS_EDGE_DIR}; skipping npm build."
else
  info "Installing dependencies..."
  npm install --prefer-offline --silent

  info "Building..."
  npm run build

  # Print dist size
  if [[ -d "dist" ]]; then
    DIST_SIZE=$(du -sh dist 2>/dev/null | cut -f1)
    success "Build complete. dist/ size: ${DIST_SIZE}"
  else
    warn "dist/ directory not found after build."
  fi
fi

# ── 4. Push to GitHub ─────────────────────────────────────────────────────────
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
info "Pushing branch '${CURRENT_BRANCH}' to origin..."

git push origin "${CURRENT_BRANCH}"
success "Pushed ${CURRENT_BRANCH} -> origin successfully."
echo ""
echo "Remote: ${REMOTE_URL}"
