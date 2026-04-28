#!/usr/bin/env bash
# Split improve/full-pass mega-commit into 14 task-scoped branches per
# FOLLOWUP_PLAN.md F6 schedule.
#
# Strategy: cherry-pick file groups from improve/full-pass onto fresh
# branches off main, in dependency order. Each branch is a single commit.
#
# Run from repo root. Assumes improve/full-pass exists.
#   ./infra/scripts/split-into-prs.sh
#
# After running:
#   git push -u origin improve/<task>      # one at a time
#   gh pr create --base main --head improve/<task> ...
#
# Branches must land in numbered order (1.1 → 1.2 → ...) because later
# changes depend on earlier (e.g., everything depends on namespace
# consolidation 1.2).
set -euo pipefail

SOURCE="${SOURCE_BRANCH:-improve/full-pass}"
BASE="${BASE_BRANCH:-main}"

if ! git rev-parse --verify "$SOURCE" >/dev/null 2>&1; then
  echo "Source branch $SOURCE not found"; exit 1
fi

create_branch() {
  local name="$1" msg="$2"; shift 2
  local files=("$@")
  echo "→ $name"
  git checkout -B "improve/$name" "$BASE"
  for path in "${files[@]}"; do
    # Use checkout-from-ref to copy paths from source branch
    git checkout "$SOURCE" -- "$path" 2>/dev/null || echo "  (skip missing: $path)"
  done
  git add -A
  if git diff --cached --quiet; then
    echo "  (no changes for $name)"; return
  fi
  git commit -m "$(printf '%s\n\nCo-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>\n' "$msg")"
}

# 1.1 Kafka DLQ
create_branch "1.1-kafka-dlq" \
  "feat(kafka): add @RetryableTopic + @DltHandler to all consumers (task 1.1)" \
  "common/service-common/src/main/java/com/fern/common/spring/config/FernSharedConfiguration.java" \
  "services/inventory-service/src/main/java/com/fern/services/inventory/application/InventoryEventConsumer.java" \
  "services/audit-service/src/main/java/com/fern/services/audit/application/AuditEventConsumer.java" \
  "services/finance-service/src/main/java/com/fern/services/finance/application/FinanceEventConsumer.java" \
  "services/auth-service/spring/src/main/java/com/fern/services/auth/spring/application/OrgEventConsumer.java"

# 1.2 Namespace — too big to enumerate; use directory globs
echo "→ 1.2-namespace-consolidation"
git checkout -B "improve/1.2-namespace-consolidation" "$BASE"
git checkout "$SOURCE" -- common/ services/ gateway/ tools/
git add -A
git commit -m "$(printf 'refactor: consolidate com.dorabets/com.natsu into com.fern.common (task 1.2)\n\nCo-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>\n')"

# 1.3 JaCoCo baseline
create_branch "1.3-jacoco-baseline" \
  "build: add JaCoCo plugin + first unit test class (task 1.3)" \
  "pom.xml" \
  "services/inventory-service/pom.xml" \
  "services/sales-service/pom.xml" \
  "services/inventory-service/src/test/java/com/fern/services/inventory/application/InventoryServiceTest.java"

# Test infra A
create_branch "test-infra-A" \
  "build: add common/test-support module + integration-tests profile + JaCoCo aggregate" \
  "pom.xml" "common/pom.xml" "common/test-support/"

# Test infra B inventory
create_branch "test-infra-B-inventory" \
  "test(inventory): InventoryRepositoryIT + jacoco:check rule" \
  "services/inventory-service/pom.xml" \
  "services/inventory-service/src/test/java/com/fern/services/inventory/infrastructure/InventoryRepositoryIT.java"

# Test infra C sales wiring
create_branch "test-infra-C-sales-wiring" \
  "build(sales): wire test-support + spring-boot exec classifier for failsafe" \
  "services/sales-service/pom.xml"

# 2.1 Circuit breaker
create_branch "2.1-circuit-breaker" \
  "feat(resilience): add @CircuitBreaker + @Retry to inter-service HTTP clients (task 2.1)" \
  "pom.xml" \
  "common/service-common/pom.xml" \
  "common/service-common/src/main/java/com/fern/common/spring/config/FernSharedConfiguration.java" \
  "common/service-common/src/main/java/com/fern/common/spring/control/MasterNodeHeartbeatAgent.java" \
  "services/payroll-service/pom.xml" \
  "services/payroll-service/src/main/java/com/fern/services/payroll/infrastructure/HrServiceClient.java" \
  "services/payroll-service/src/main/resources/application.yml" \
  "services/finance-service/pom.xml" \
  "services/finance-service/src/main/java/com/fern/services/finance/application/InvoiceService.java" \
  "services/finance-service/src/main/resources/application.yml"

# 2.3 Catalog SQL pushdown
create_branch "2.3-catalog-sql-pushdown" \
  "perf(catalog): rewrite findMenu single-query, batch loadCategories/loadItems with IN clause (task 2.3)" \
  "services/product-service/src/main/java/com/fern/services/product/infrastructure/MenuRepository.java"

# 2.4 OTel
create_branch "2.4-otel" \
  "feat(observability): wire OpenTelemetry on all services + Jaeger compose (task 2.4)" \
  "pom.xml" \
  "common/service-common/pom.xml" \
  "common/service-common/src/main/java/com/fern/common/spring/web/CorrelationIdToTraceFilter.java" \
  "infra/docker-compose.yml" \
  "infra/.env.example" \
  "services/inventory-service/pom.xml" \
  "services/sales-service/pom.xml" \
  "services/audit-service/pom.xml" \
  "services/auth-service/spring/pom.xml" \
  "services/finance-service/pom.xml" \
  "services/hr-service/pom.xml" \
  "services/master-node/pom.xml" \
  "services/org-service/pom.xml" \
  "services/payroll-service/pom.xml" \
  "services/procurement-service/pom.xml" \
  "services/product-service/pom.xml" \
  "services/report-service/pom.xml" \
  "gateway/pom.xml"

# 3.1 Multi-terminal POS
create_branch "3.1-multi-terminal-pos" \
  "feat(pos): multi-terminal session unique + scoped lookup wired into approveSale (task 3.1, F5)" \
  "db/migrations/V49__pos_session_multi_terminal.sql" \
  "services/sales-service/src/main/java/com/fern/services/sales/infrastructure/SalesRepository.java"

# 3.2 Report expansion
create_branch "3.2-report-expansion" \
  "feat(report): pnl + top-skus + staff-kpi + cross-outlet endpoints (task 3.2)" \
  "services/report-service/src/main/java/com/fern/services/report/api/ReportDtos.java" \
  "services/report-service/src/main/java/com/fern/services/report/api/ReportController.java" \
  "services/report-service/src/main/java/com/fern/services/report/application/ReportService.java" \
  "services/report-service/src/main/java/com/fern/services/report/infrastructure/ReportRepository.java"

# 3.3 Promotion engine
create_branch "3.3-promotion-engine" \
  "feat(promotion): PromotionEngine + repo query, integrated into PublicPosService (task 3.3, F4)" \
  "services/sales-service/src/main/java/com/fern/services/sales/application/PromotionEngine.java" \
  "services/sales-service/src/main/java/com/fern/services/sales/application/PublicPosService.java" \
  "services/sales-service/src/main/java/com/fern/services/sales/infrastructure/SalesRepository.java" \
  "services/sales-service/src/test/java/com/fern/services/sales/application/PublicPosServiceTest.java"

# 3.5 Vault
create_branch "3.5-vault" \
  "feat(secrets): Vault dev container + Spring Cloud Vault wiring + seed script (task 3.5, F3)" \
  "pom.xml" \
  "common/service-common/pom.xml" \
  "common/service-common/src/main/java/com/fern/common/spring/config/FernSharedConfiguration.java" \
  "infra/docker-compose.yml" \
  "infra/.env.example" \
  "infra/scripts/vault-seed-dev.sh"

# 3.6 E2E
create_branch "3.6-e2e-sales-flow" \
  "test(e2e): sales-flow golden path Playwright spec (task 3.6)" \
  "frontend/e2e/sales-flow.spec.ts"

# Docs
create_branch "docs-improvement-plan" \
  "docs: IMPROVEMENT_PLAN, FOLLOWUP_PLAN, TEST_COVERAGE_PLAN, VAULT_INTEGRATION_PLAN" \
  "docs/IMPROVEMENT_PLAN.md" \
  "docs/FOLLOWUP_PLAN.md" \
  "docs/TEST_COVERAGE_PLAN.md" \
  "docs/VAULT_INTEGRATION_PLAN.md"

git checkout "$BASE"
echo
echo "Done. Branches:"
git branch | grep "improve/" | sed 's/^/  /'
echo
echo "Push individually after review:"
echo "  git push -u origin improve/1.1-kafka-dlq"
echo "  gh pr create --base $BASE --head improve/1.1-kafka-dlq"
