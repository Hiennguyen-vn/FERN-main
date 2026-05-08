package com.fern.services.sales.infrastructure;

import com.fern.common.spring.auth.JwtTokenService;
import com.fern.common.spring.auth.SpringInternalServiceAuth;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.util.UriComponentsBuilder;

/**
 * Reads stock availability from inventory-service over HTTP.
 * Used when sales.inventory.read-mode=service. Fall back to direct DB read otherwise.
 */
@Component
public class InventoryAvailabilityClient {

  private final RestClient restClient;
  private final SpringInternalServiceAuth internalAuth;
  private final JwtTokenService jwtTokenService;
  private final ObjectMapper objectMapper;
  private final String inventoryBaseUrl;

  public InventoryAvailabilityClient(
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

  public Map<Long, BigDecimal> available(long outletId, List<Long> itemIds) {
    if (itemIds == null || itemIds.isEmpty()) return Map.of();
    UriComponentsBuilder uri = UriComponentsBuilder.fromUriString(inventoryBaseUrl)
        .path("/api/v1/inventory/stock-available")
        .queryParam("locationId", outletId);
    for (Long id : itemIds) uri.queryParam("itemId", id);

    HttpHeaders headers = new HttpHeaders();
    internalAuth.applyWithJwt(headers, "sales-service", "inventory-service", jwtTokenService, null);

    String body = restClient.get()
        .uri(uri.build().toUri())
        .headers(h -> h.addAll(headers))
        .retrieve()
        .body(String.class);
    try {
      JsonNode root = objectMapper.readTree(body);
      JsonNode available = root.path("available");
      Map<Long, BigDecimal> result = new HashMap<>();
      available.fields().forEachRemaining(e -> {
        result.put(Long.parseLong(e.getKey()), new BigDecimal(e.getValue().asText("0")));
      });
      return result;
    } catch (Exception e) {
      throw new IllegalStateException("Failed to parse stock-available response", e);
    }
  }
}
