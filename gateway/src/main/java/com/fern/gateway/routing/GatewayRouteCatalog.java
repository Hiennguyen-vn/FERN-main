package com.fern.gateway.routing;

import java.util.List;

public final class GatewayRouteCatalog {

  private GatewayRouteCatalog() {
  }

  public static List<GatewayRoute> routes() {
    return List.of(
        new GatewayRoute("/api/v1/auth", "auth-service", env("AUTH_SERVICE_URL", "http://localhost:8081")),
        new GatewayRoute("/api/v1/master", "master-node", env("MASTER_NODE_URL", "http://localhost:8082")),
        new GatewayRoute("/api/v1/control", "master-node", env("MASTER_NODE_URL", "http://localhost:8082")),
        new GatewayRoute("/api/v1/org", "org-service", env("ORG_SERVICE_URL", "http://localhost:8083")),
        new GatewayRoute("/api/v1/hr", "hr-service", env("HR_SERVICE_URL", "http://localhost:8084")),
        new GatewayRoute("/api/v1/product", "product-service", env("PRODUCT_SERVICE_URL", "http://localhost:8085")),
        new GatewayRoute("/api/v1/products", "product-service", env("PRODUCT_SERVICE_URL", "http://localhost:8085")),
        new GatewayRoute("/api/v1/procurement", "procurement-service", env("PROCUREMENT_SERVICE_URL", "http://localhost:8086")),
        new GatewayRoute("/api/v1/sales", "sales-service", env("SALES_SERVICE_URL", "http://localhost:8087")),
        new GatewayRoute("/api/v1/crm", "sales-service", env("SALES_SERVICE_URL", "http://localhost:8087")),
        new GatewayRoute("/api/v1/inventory", "inventory-service", env("INVENTORY_SERVICE_URL", "http://localhost:8088")),
        new GatewayRoute("/api/v1/payroll", "payroll-service", env("PAYROLL_SERVICE_URL", "http://localhost:8089")),
        new GatewayRoute("/api/v1/finance", "finance-service", env("FINANCE_SERVICE_URL", "http://localhost:8090")),
        new GatewayRoute("/api/v1/audit", "audit-service", env("AUDIT_SERVICE_URL", "http://localhost:8091")),
        new GatewayRoute("/api/v1/report", "report-service", env("REPORT_SERVICE_URL", "http://localhost:8092")),
        new GatewayRoute("/api/v1/reports", "report-service", env("REPORT_SERVICE_URL", "http://localhost:8092")),
        new GatewayRoute("/api/v1/gateway", "gateway", env("GATEWAY_URL", "http://localhost:8080"))
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
