package com.fern.services.sync.application;

import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.stereotype.Component;

@Component("syncRuntime")
public class SyncRuntimeHealthIndicator implements HealthIndicator {

  private final SyncProperties properties;
  private final com.fern.services.sync.state.SyncRepository syncRepository;

  public SyncRuntimeHealthIndicator(SyncProperties properties, com.fern.services.sync.state.SyncRepository syncRepository) {
    this.properties = properties;
    this.syncRepository = syncRepository;
  }

  @Override
  public Health health() {
    if (!properties.isEnabled()) {
      return Health.up()
          .withDetail("enabled", false)
          .withDetail("mode", properties.getMode().name())
          .withDetail("runtimeRole", properties.effectiveRole().name())
          .withDetail("role", "disabled")
          .build();
    }
    if (RuntimeRoleSupport.isHubRole(properties)) {
      com.fern.services.sync.state.SyncRepository.HubOverviewRow overview = syncRepository.hubOverview(properties.getNodeId());
      return Health.up()
          .withDetail("enabled", true)
          .withDetail("mode", properties.getMode().name())
          .withDetail("runtimeRole", properties.effectiveRole().name())
          .withDetail("role", "hubRole")
          .withDetail("nodeId", properties.getNodeId())
          .withDetail("storeId", properties.getStoreId())
          .withDetail("managedChildCount", overview.managedChildCount())
          .withDetail("revokedChildCount", overview.revokedChildCount())
          .withDetail("pendingForwardingCount", overview.pendingForwardingCount())
          .withDetail("pendingRelayCount", overview.pendingRelayCount())
          .withDetail("lastForwardingSuccessAt", overview.lastForwardingSuccessAt())
          .withDetail("lastRelaySuccessAt", overview.lastRelaySuccessAt())
          .build();
    }
    if (RuntimeRoleSupport.isStoreRole(properties)) {
      return Health.up()
          .withDetail("enabled", true)
          .withDetail("mode", properties.getMode().name())
          .withDetail("runtimeRole", properties.effectiveRole().name())
          .withDetail("role", "edgeRole")
          .withDetail("nodeId", properties.getNodeId())
          .withDetail("storeId", properties.getStoreId())
          .build();
    }
    return Health.up()
        .withDetail("enabled", true)
        .withDetail("mode", properties.getMode().name())
        .withDetail("runtimeRole", properties.effectiveRole().name())
        .withDetail("role", "centralRole")
        .build();
  }
}
