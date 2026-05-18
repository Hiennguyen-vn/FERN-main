package com.fern.services.sales.application.kitchen;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fern.common.spring.auth.JwtTokenService;
import com.fern.common.spring.auth.SpringInternalServiceAuth;
import com.fern.services.sales.api.kitchen.KitchenDtos;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * Pushes kitchen ticket events to the gateway WebSocket broadcaster. Failures are logged
 * but never block the calling business transaction.
 */
@Component
public class KitchenSyncPublisher {

  private static final Logger log = LoggerFactory.getLogger(KitchenSyncPublisher.class);

  private final RestClient restClient;
  private final SpringInternalServiceAuth internalAuth;
  private final JwtTokenService jwtTokenService;
  private final ObjectMapper objectMapper;
  private final String gatewayBaseUrl;

  public KitchenSyncPublisher(
      RestClient.Builder restClientBuilder,
      SpringInternalServiceAuth internalAuth,
      JwtTokenService jwtTokenService,
      ObjectMapper objectMapper,
      @Value("${gateway.base-url:http://gateway:8082}") String gatewayBaseUrl
  ) {
    this.restClient = restClientBuilder.build();
    this.internalAuth = internalAuth;
    this.jwtTokenService = jwtTokenService;
    this.objectMapper = objectMapper;
    this.gatewayBaseUrl = gatewayBaseUrl.strip().replaceAll("/$", "");
  }

  public void publishTicketCreated(KitchenDtos.TicketView ticket) {
    publish(ticket.outletId(), "kitchen.ticket.created", Map.of("ticket", ticket));
  }

  public void publishTicketUpdated(KitchenDtos.TicketView ticket) {
    publish(ticket.outletId(), "kitchen.ticket.updated", Map.of("ticket", ticket));
  }

  public void publishSlaBreached(long outletId, long ticketId) {
    publish(outletId, "kitchen.sla.breached", Map.of("ticketId", ticketId));
  }

  private void publish(long outletId, String type, Map<String, Object> payload) {
    Map<String, Object> envelope = new LinkedHashMap<>();
    envelope.put("type", type);
    envelope.putAll(payload);
    String body;
    try {
      body = objectMapper.writeValueAsString(envelope);
    } catch (Exception e) {
      log.warn("kitchen sync serialize failed type={} outlet={}: {}", type, outletId, e.getMessage());
      return;
    }
    HttpHeaders headers = new HttpHeaders();
    internalAuth.applyWithJwt(headers, "sales-service", "gateway", jwtTokenService, null);
    headers.setContentType(MediaType.APPLICATION_JSON);
    try {
      restClient.post()
          .uri(gatewayBaseUrl + "/api/v1/gateway/sync/publish/" + outletId)
          .headers(h -> h.addAll(headers))
          .body(body)
          .retrieve()
          .toBodilessEntity();
    } catch (Exception e) {
      log.warn("kitchen sync publish failed type={} outlet={}: {}", type, outletId, e.getMessage());
    }
  }
}
