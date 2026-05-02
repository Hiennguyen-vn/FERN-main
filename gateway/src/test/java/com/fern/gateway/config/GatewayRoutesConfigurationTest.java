package com.fern.gateway.config;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.fern.gateway.routing.GatewayRoute;
import org.junit.jupiter.api.Test;

class GatewayRoutesConfigurationTest {

  @Test
  void circuitBreakerNameMatchesServiceName() {
    GatewayRoute sales = new GatewayRoute("/api/v1/sales", "sales-service", "http://localhost:8087");
    GatewayRoute sync = new GatewayRoute("/api/v1/sync", "sales-service", "http://localhost:8087");

    assertEquals("sales-service", GatewayRoutesConfiguration.circuitBreakerName(sales));
    assertEquals("sales-service", GatewayRoutesConfiguration.circuitBreakerName(sync));
  }
}
