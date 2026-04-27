package com.fern.gateway.routing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class GatewayRouteCatalogTest {

  @Test
  void resolveUsesLongestMatchingPrefix() {
    GatewayRoute route = GatewayRouteCatalog.resolve("/api/v1/products/route-probe");

    assertEquals("product-service", route.serviceName());
    assertEquals("/api/v1/products", route.pathPrefix());
  }

  @Test
  void resolveReturnsNullForUnknownPath() {
    assertNull(GatewayRouteCatalog.resolve("/api/v1/unknown/path"));
  }

  @Test
  void devicePairRoutesResolveToAuthService() {
    GatewayRoute pairTokenRoute = GatewayRouteCatalog.resolve("/api/v1/devices/pair-token");
    GatewayRoute pairRoute = GatewayRouteCatalog.resolve("/api/v1/devices/pair");
    GatewayRoute refreshRoute = GatewayRouteCatalog.resolve("/api/v1/devices/refresh");

    assertEquals("auth-service", pairTokenRoute.serviceName());
    assertEquals("auth-service", pairRoute.serviceName());
    assertEquals("auth-service", refreshRoute.serviceName());
  }

  @Test
  void deviceProvisionRouteStaysOnSalesService() {
    GatewayRoute route = GatewayRouteCatalog.resolve("/api/v1/devices/provision");

    assertEquals("sales-service", route.serviceName());
    assertEquals("/api/v1/devices/provision", route.pathPrefix());
  }

  @Test
  void routesExposeExpectedIngressPrefixes() {
    assertTrue(GatewayRouteCatalog.routes().stream().anyMatch(route -> route.pathPrefix().equals("/api/v1/auth")));
    assertTrue(GatewayRouteCatalog.routes().stream().anyMatch(route -> route.pathPrefix().equals("/api/v1/control")));
    assertTrue(GatewayRouteCatalog.routes().stream().anyMatch(route -> route.pathPrefix().equals("/api/v1/reports")));
  }
}
