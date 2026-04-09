package com.fern.gateway.web;

import com.fern.gateway.routing.GatewayRouteCatalog;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class GatewayInfoController {

  @Value("${server.port:8080}")
  private int port;

  @Value("${spring.application.name:gateway}")
  private String serviceName;

  @GetMapping("/api/v1/gateway/routes")
  public Object routes() {
    return GatewayRouteCatalog.routes();
  }

  @GetMapping("/api/v1/gateway/targets")
  public Object targets() {
    return Map.of("routes", GatewayRouteCatalog.routes());
  }

  @GetMapping("/api/v1/gateway/info")
  public Object info() {
    return Map.of(
        "service", serviceName,
        "port", port,
        "routingMode", "spring-cloud-gateway",
        "status", "READY"
    );
  }

  @GetMapping("/health/live")
  public Object live() {
    return Map.of("status", "UP");
  }

  @GetMapping("/health/ready")
  public Object ready() {
    return Map.of("status", "UP");
  }
}
