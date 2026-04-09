package com.dorabets.common.spring.control;

import com.dorabets.common.spring.config.FernServiceProperties;
import java.net.InetAddress;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

@Component
public class MasterNodeHeartbeatAgent {

  private static final Logger log = LoggerFactory.getLogger(MasterNodeHeartbeatAgent.class);

  private final RestClient restClient;
  private final FernServiceProperties properties;
  private final String serviceName;
  private final int port;
  private final AtomicLong instanceId = new AtomicLong();

  public MasterNodeHeartbeatAgent(
      RestClient.Builder restClientBuilder,
      FernServiceProperties properties,
      @Value("${spring.application.name:unknown-service}") String serviceName,
      @Value("${server.port:0}") int port
  ) {
    this.restClient = restClientBuilder.baseUrl(properties.getMasterNode().getBaseUrl()).build();
    this.properties = properties;
    this.serviceName = serviceName;
    this.port = port;
  }

  @Scheduled(
      initialDelayString = "#{${dependencies.masterNode.heartbeatIntervalSeconds:10} * 1000}",
      fixedDelayString = "#{${dependencies.masterNode.heartbeatIntervalSeconds:10} * 1000}"
  )
  public void heartbeat() {
    if (!properties.getMasterNode().isHeartbeatEnabled()) {
      return;
    }
    try {
      HeartbeatResponse response = restClient.post()
          .uri("/api/v1/master/heartbeat")
          .body(new HeartbeatRequest(
              instanceId.get() == 0 ? null : instanceId.get(),
              serviceName,
              resolveHost(),
              port,
              env("APP_VERSION", "local"),
              "spring-boot",
              List.of(),
              List.of(),
              List.of("http"),
              Map.of("startedAt", Instant.now().toString()),
              "UP"
          ))
          .retrieve()
          .body(HeartbeatResponse.class);
      if (response != null && response.instanceId() != null) {
        instanceId.set(response.instanceId());
      }
    } catch (Exception e) {
      log.debug("Master-node heartbeat failed for {}: {}", serviceName, e.getMessage());
    }
  }

  private static String resolveHost() {
    try {
      return InetAddress.getLocalHost().getHostAddress();
    } catch (Exception ignored) {
      return "127.0.0.1";
    }
  }

  private static String env(String key, String fallback) {
    String value = System.getenv(key);
    return value != null && !value.isBlank() ? value : fallback;
  }

  public record HeartbeatRequest(
      Long instanceId,
      String serviceName,
      String host,
      Integer port,
      String version,
      String runtime,
      List<String> regionCodes,
      List<Long> outletIds,
      List<String> capabilities,
      Map<String, Object> metadata,
      String status
  ) {
  }

  public record HeartbeatResponse(
      Long instanceId,
      String status,
      Integer leaseTtlSeconds
  ) {
  }
}
