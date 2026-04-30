package com.fern.gateway.config;

import static org.junit.jupiter.api.Assertions.assertNotEquals;

import com.fern.gateway.routing.GatewayRoute;
import org.junit.jupiter.api.Test;

class GatewayRoutesConfigurationTest {

  @Test
  void circuitBreakerNameSeparatesRoutesOnTheSameService() {
    GatewayRoute sales = new GatewayRoute("/api/v1/sales", "sales-service", "http://localhost:8087");
    GatewayRoute sync = new GatewayRoute("/api/v1/sync", "sales-service", "http://localhost:8087");

    assertNotEquals(
        GatewayRoutesConfiguration.circuitBreakerName(sales),
        GatewayRoutesConfiguration.circuitBreakerName(sync));
  }
}
