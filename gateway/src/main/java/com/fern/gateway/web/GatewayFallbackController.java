package com.fern.gateway.web;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.cloud.gateway.support.ServerWebExchangeUtils;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ServerWebExchange;

@RestController
public class GatewayFallbackController {

  @RequestMapping("/internal/gateway/fallback/{serviceName}")
  public ResponseEntity<Map<String, Object>> fallback(
      @PathVariable String serviceName,
      ServerWebExchange exchange
  ) {
    Throwable cause = exchange.getAttribute(ServerWebExchangeUtils.CIRCUITBREAKER_EXECUTION_EXCEPTION_ATTR);
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("error", "upstream_unavailable");
    payload.put("service", serviceName);
    payload.put("path", exchange.getRequest().getURI().getPath());
    payload.put("correlation_id", exchange.getRequest().getHeaders().getFirst("X-Correlation-ID"));
    payload.put("message", cause == null ? "Upstream service is unavailable" : cause.getMessage());
    payload.put("timestamp", Instant.now().toString());
    return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(payload);
  }
}
