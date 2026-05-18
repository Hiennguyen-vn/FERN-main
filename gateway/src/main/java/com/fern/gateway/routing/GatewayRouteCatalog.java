package com.fern.gateway.routing;

import com.fern.gateway.routing.GatewayRoute.RateLimitTier;
import com.fern.gateway.routing.GatewayRoute.RouteClass;
import java.util.List;

public final class GatewayRouteCatalog {

  private GatewayRouteCatalog() {
  }

  public static List<GatewayRoute> routes() {
    String authUrl = env("AUTH_SERVICE_URL", "http://localhost:8081");
    String masterUrl = env("MASTER_NODE_URL", "http://localhost:8082");
    String orgUrl = env("ORG_SERVICE_URL", "http://localhost:8083");
    String hrUrl = env("HR_SERVICE_URL", "http://localhost:8084");
    String productUrl = env("PRODUCT_SERVICE_URL", "http://localhost:8085");
    String procurementUrl = env("PROCUREMENT_SERVICE_URL", "http://localhost:8086");
    String salesUrl = env("SALES_SERVICE_URL", "http://localhost:8087");
    String inventoryUrl = env("INVENTORY_SERVICE_URL", "http://localhost:8088");
    String payrollUrl = env("PAYROLL_SERVICE_URL", "http://localhost:8089");
    String financeUrl = env("FINANCE_SERVICE_URL", "http://localhost:8090");
    String auditUrl = env("AUDIT_SERVICE_URL", "http://localhost:8091");
    String reportUrl = env("REPORT_SERVICE_URL", "http://localhost:8092");
    String aiQueryUrl = env("AI_QUERY_SERVICE_URL", "http://localhost:8093");
    String gatewayUrl = env("GATEWAY_URL", "http://localhost:8080");

    return List.of(
        new GatewayRoute("/api/v1/auth", "auth-service", authUrl, RouteClass.USER, RateLimitTier.AUTH),
        new GatewayRoute("/api/v1/master", "master-node", masterUrl, RouteClass.INTERNAL_ONLY, RateLimitTier.DEFAULT),
        new GatewayRoute("/api/v1/control", "master-node", masterUrl, RouteClass.INTERNAL_ONLY, RateLimitTier.DEFAULT),
        new GatewayRoute("/api/v1/org", "org-service", orgUrl, RouteClass.USER, RateLimitTier.DEFAULT),
        new GatewayRoute("/api/v1/hr", "hr-service", hrUrl, RouteClass.USER, RateLimitTier.DEFAULT),
        new GatewayRoute("/api/v1/product", "product-service", productUrl, RouteClass.USER, RateLimitTier.DEFAULT),
        new GatewayRoute("/api/v1/products", "product-service", productUrl, RouteClass.USER, RateLimitTier.DEFAULT),
        new GatewayRoute("/api/v1/allergens", "product-service", productUrl, RouteClass.USER, RateLimitTier.DEFAULT),
        new GatewayRoute("/api/v1/product-allergens", "product-service", productUrl, RouteClass.USER, RateLimitTier.DEFAULT),
        new GatewayRoute("/api/v1/modifier-groups", "product-service", productUrl, RouteClass.USER, RateLimitTier.DEFAULT),
        new GatewayRoute("/api/v1/customer-allergies", "product-service", productUrl, RouteClass.USER, RateLimitTier.DEFAULT),
        new GatewayRoute("/api/v1/procurement", "procurement-service", procurementUrl, RouteClass.USER, RateLimitTier.DEFAULT),
        new GatewayRoute("/api/v1/sales", "sales-service", salesUrl, RouteClass.USER, RateLimitTier.DEFAULT),
        new GatewayRoute("/api/v1/crm", "sales-service", salesUrl, RouteClass.USER, RateLimitTier.DEFAULT),
        new GatewayRoute("/api/v1/sync", "sales-service", salesUrl, RouteClass.DEVICE, RateLimitTier.SYNC),
        new GatewayRoute("/api/v1/telemetry", "sales-service", salesUrl, RouteClass.DEVICE, RateLimitTier.TELEMETRY),
        new GatewayRoute("/api/v1/devices", "auth-service", authUrl, RouteClass.USER, RateLimitTier.AUTH),
        new GatewayRoute("/api/v1/inventory", "inventory-service", inventoryUrl, RouteClass.USER, RateLimitTier.DEFAULT),
        new GatewayRoute("/api/v1/payroll", "payroll-service", payrollUrl, RouteClass.USER, RateLimitTier.DEFAULT),
        new GatewayRoute("/api/v1/finance", "finance-service", financeUrl, RouteClass.USER, RateLimitTier.DEFAULT),
        new GatewayRoute("/api/v1/audit", "audit-service", auditUrl, RouteClass.USER, RateLimitTier.DEFAULT),
        new GatewayRoute("/api/v1/report", "report-service", reportUrl, RouteClass.USER, RateLimitTier.REPORT),
        new GatewayRoute("/api/v1/reports", "report-service", reportUrl, RouteClass.USER, RateLimitTier.REPORT),
        new GatewayRoute("/api/v1/ai-query", "ai-query-service", aiQueryUrl, RouteClass.USER, RateLimitTier.AI_QUERY),
        new GatewayRoute("/api/v1/gateway", "gateway", gatewayUrl, RouteClass.PUBLIC, RateLimitTier.DEFAULT)
    );
  }

  public static GatewayRoute resolve(String path) {
    GatewayRoute bestMatch = null;
    for (GatewayRoute route : routes()) {
      if (path == null || !path.startsWith(route.pathPrefix())) {
        continue;
      }
      if (bestMatch == null || route.pathPrefix().length() > bestMatch.pathPrefix().length()) {
        bestMatch = route;
      }
    }
    return bestMatch;
  }

  private static String env(String key, String defaultValue) {
    String value = System.getenv(key);
    return value != null && !value.isBlank() ? value : defaultValue;
  }
}
