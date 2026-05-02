package com.fern.gateway.routing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import com.fern.gateway.routing.GatewayRoute.RateLimitTier;
import com.fern.gateway.routing.GatewayRoute.RouteClass;
import org.junit.jupiter.api.Test;

class GatewayRouteClassificationTest {

  @Test
  void syncRouteIsDeviceClass() {
    GatewayRoute route = GatewayRouteCatalog.resolve("/api/v1/sync/menu");
    assertNotNull(route);
    assertEquals(RouteClass.DEVICE, route.routeClass());
    assertEquals(RateLimitTier.SYNC, route.rateLimitTier());
  }

  @Test
  void telemetryRouteIsDeviceClass() {
    GatewayRoute route = GatewayRouteCatalog.resolve("/api/v1/telemetry");
    assertNotNull(route);
    assertEquals(RouteClass.DEVICE, route.routeClass());
    assertEquals(RateLimitTier.TELEMETRY, route.rateLimitTier());
  }

  @Test
  void controlPlaneIsInternalOnly() {
    GatewayRoute route = GatewayRouteCatalog.resolve("/api/v1/control/services");
    assertNotNull(route);
    assertEquals(RouteClass.INTERNAL_ONLY, route.routeClass());
  }

  @Test
  void authRouteUsesAuthTier() {
    GatewayRoute route = GatewayRouteCatalog.resolve("/api/v1/auth/login");
    assertNotNull(route);
    assertEquals(RateLimitTier.AUTH, route.rateLimitTier());
  }

  @Test
  void reportRouteUsesReportTier() {
    GatewayRoute route = GatewayRouteCatalog.resolve("/api/v1/reports/daily");
    assertNotNull(route);
    assertEquals(RateLimitTier.REPORT, route.rateLimitTier());
  }
}
