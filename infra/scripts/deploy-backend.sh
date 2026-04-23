#!/usr/bin/env bash
# deploy-backend.sh — Deploy FERN backend services on a Linux server.
# Usage: ./deploy-backend.sh [--profile <spring-profile>]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="${LOG_DIR:-/var/log/fern}"
PID_DIR="${PID_DIR:-/var/run/fern}"
JAR_DIR="${REPO_ROOT}"
SPRING_PROFILE="${SPRING_PROFILE:-prod}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}"  # seconds to wait for health check

# ── Service definitions: name, module dir, port ──────────────────────────────
declare -A SERVICE_MODULE=(
  [auth-service]=auth-service
  [org-service]=org-service
  [product-service]=product-service
  [inventory-service]=inventory-service
  [sales-service]=sales-service
  [gateway]=gateway
)
declare -A SERVICE_PORT=(
  [auth-service]=8081
  [org-service]=8082
  [product-service]=8083
  [inventory-service]=8084
  [sales-service]=8085
  [gateway]=8080
)
# Start gateway last — it depends on all upstream services
SERVICE_ORDER=(auth-service org-service product-service inventory-service sales-service gateway)

# ── Helpers ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

info()    { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
fail()    { echo -e "${RED}[FAIL]${NC}  $*"; }

# ── 1. Check Java 21 ──────────────────────────────────────────────────────────
check_java() {
  info "Checking Java version..."
  if ! command -v java &>/dev/null; then
    error "java not found. Install Java 21 (e.g. sudo apt install openjdk-21-jdk)."
    exit 1
  fi
  JAVA_VER=$(java -version 2>&1 | awk -F '"' '/version/ {print $2}' | cut -d'.' -f1)
  if [[ "$JAVA_VER" != "21" ]]; then
    error "Java 21 required, found major version ${JAVA_VER}."
    exit 1
  fi
  success "Java 21 detected."
}

# ── 2. Pull latest git ────────────────────────────────────────────────────────
pull_latest() {
  info "Pulling latest changes from git..."
  cd "$REPO_ROOT"
  git fetch --prune
  git pull --ff-only
  success "Repository up to date: $(git log -1 --oneline)"
}

# ── 3. Build ──────────────────────────────────────────────────────────────────
build() {
  info "Building all modules (mvn clean package -DskipTests)..."
  cd "$REPO_ROOT"
  mvn clean package -DskipTests -q
  success "Build complete."
}

# ── 4. Stop existing service ──────────────────────────────────────────────────
stop_service() {
  local name="$1"
  local pid_file="${PID_DIR}/${name}.pid"

  # Try systemd first
  if systemctl is-active --quiet "fern-${name}" 2>/dev/null; then
    info "Stopping systemd service fern-${name}..."
    systemctl stop "fern-${name}"
    return
  fi

  # Fall back to PID file
  if [[ -f "$pid_file" ]]; then
    local pid
    pid=$(cat "$pid_file")
    if kill -0 "$pid" 2>/dev/null; then
      info "Stopping ${name} (PID ${pid})..."
      kill "$pid"
      local waited=0
      while kill -0 "$pid" 2>/dev/null && (( waited < 30 )); do
        sleep 1; (( waited++ ))
      done
      if kill -0 "$pid" 2>/dev/null; then
        warn "Process ${pid} did not stop gracefully; sending SIGKILL."
        kill -9 "$pid" || true
      fi
    fi
    rm -f "$pid_file"
  else
    warn "No pid file found for ${name} at ${pid_file}; assuming not running."
  fi
}

# ── 5. Start service ──────────────────────────────────────────────────────────
start_service() {
  local name="$1"
  local module="${SERVICE_MODULE[$name]}"
  local port="${SERVICE_PORT[$name]}"
  local jar
  jar=$(find "${REPO_ROOT}/${module}/target" -maxdepth 1 -name "*.jar" ! -name "*sources*" 2>/dev/null | head -1)

  if [[ -z "$jar" ]]; then
    error "JAR not found for ${name} under ${REPO_ROOT}/${module}/target/"
    return 1
  fi

  mkdir -p "$LOG_DIR" "$PID_DIR"

  # Try systemd first
  if systemctl list-unit-files "fern-${name}.service" &>/dev/null 2>&1; then
    info "Starting ${name} via systemd..."
    systemctl start "fern-${name}"
    return
  fi

  # Direct launch
  info "Starting ${name} (port ${port}, profile ${SPRING_PROFILE})..."
  nohup java -jar "$jar" \
    --server.port="${port}" \
    --spring.profiles.active="${SPRING_PROFILE}" \
    >> "${LOG_DIR}/${name}.log" 2>&1 &
  echo $! > "${PID_DIR}/${name}.pid"
  info "${name} started with PID $!"
}

# ── 6. Health check ───────────────────────────────────────────────────────────
wait_for_health() {
  local name="$1"
  local port="${SERVICE_PORT[$name]}"
  local url="http://localhost:${port}/actuator/health"
  local elapsed=0

  info "Waiting for ${name} health check at ${url}..."
  while (( elapsed < HEALTH_TIMEOUT )); do
    if curl -sf "$url" | grep -q '"status":"UP"' 2>/dev/null; then
      return 0
    fi
    sleep 2
    (( elapsed += 2 ))
  done
  return 1
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
  check_java
  pull_latest
  build

  declare -A RESULTS

  for svc in "${SERVICE_ORDER[@]}"; do
    echo ""
    info "─── Deploying ${svc} ───────────────────────────────────────────────"
    stop_service "$svc"
    if start_service "$svc"; then
      sleep 3  # brief pause before polling
      if wait_for_health "$svc"; then
        success "${svc} is UP on port ${SERVICE_PORT[$svc]}."
        RESULTS[$svc]="UP"
      else
        fail "${svc} did not become healthy within ${HEALTH_TIMEOUT}s. Check ${LOG_DIR}/${svc}.log"
        RESULTS[$svc]="FAILED (health check timeout)"
      fi
    else
      fail "${svc} failed to start."
      RESULTS[$svc]="FAILED (start error)"
    fi
  done

  echo ""
  echo "════════════════════════════════════════════"
  echo " Deployment Summary"
  echo "════════════════════════════════════════════"
  for svc in "${SERVICE_ORDER[@]}"; do
    status="${RESULTS[$svc]:-UNKNOWN}"
    if [[ "$status" == "UP" ]]; then
      success "${svc}: ${status}"
    else
      fail "${svc}: ${status}"
    fi
  done
  echo "════════════════════════════════════════════"
}

main "$@"
