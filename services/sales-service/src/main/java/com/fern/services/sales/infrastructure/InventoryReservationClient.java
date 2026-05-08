package com.fern.services.sales.infrastructure;

import com.fern.common.spring.auth.JwtTokenService;
import com.fern.common.spring.auth.SpringInternalServiceAuth;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * Reserves stock against inventory-service over HTTP.
 * Used when sales.reservation.enabled=true. Default off during W0.3 rollout.
 */
@Component
public class InventoryReservationClient {

  private final RestClient restClient;
  private final SpringInternalServiceAuth internalAuth;
  private final JwtTokenService jwtTokenService;
  private final ObjectMapper objectMapper;
  private final String inventoryBaseUrl;

  public InventoryReservationClient(
      RestClient.Builder restClientBuilder,
      SpringInternalServiceAuth internalAuth,
      JwtTokenService jwtTokenService,
      ObjectMapper objectMapper,
      @Value("${inventory-service.base-url:http://inventory-service:8080}") String inventoryBaseUrl
  ) {
    this.restClient = restClientBuilder.build();
    this.internalAuth = internalAuth;
    this.jwtTokenService = jwtTokenService;
    this.objectMapper = objectMapper;
    this.inventoryBaseUrl = inventoryBaseUrl.strip().replaceAll("/$", "");
  }

  public record ReserveLine(long itemId, BigDecimal qty) {}

  public void reserve(long outletId, long saleId, List<ReserveLine> lines, long ttlSeconds) {
    if (lines == null || lines.isEmpty()) return;
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("locationId", outletId);
    body.put("saleId", saleId);
    body.put("ttlSeconds", ttlSeconds);
    List<Map<String, Object>> linesPayload = new java.util.ArrayList<>();
    for (ReserveLine l : lines) {
      Map<String, Object> entry = new LinkedHashMap<>();
      entry.put("itemId", l.itemId());
      entry.put("qty", l.qty());
      linesPayload.add(entry);
    }
    body.put("lines", linesPayload);

    HttpHeaders headers = new HttpHeaders();
    internalAuth.applyWithJwt(headers, "sales-service", "inventory-service", jwtTokenService, null);
    headers.setContentType(MediaType.APPLICATION_JSON);

    try {
      restClient.post()
          .uri(inventoryBaseUrl + "/api/v1/inventory/reservations")
          .headers(h -> h.addAll(headers))
          .body(objectMapper.writeValueAsString(body))
          .retrieve()
          .toBodilessEntity();
    } catch (Exception e) {
      throw new IllegalStateException("Failed to reserve stock", e);
    }
  }
}
