package com.fern.services.sync.shared;

import com.fern.services.sync.application.SyncProperties;
import org.springframework.stereotype.Component;

@Component
public class SyncRuntimeRoleResolver {

  private final SyncProperties properties;

  public SyncRuntimeRoleResolver(SyncProperties properties) {
    this.properties = properties;
  }

  public SyncRuntimeMode currentMode() {
    return switch (properties.effectiveRole()) {
      case MASTER_CENTRAL -> SyncRuntimeMode.CENTRAL_ROLE;
      case OUTLET_EDGE -> SyncRuntimeMode.EDGE_ROLE;
      case REGIONAL_HUB -> SyncRuntimeMode.HUB_ROLE;
    };
  }

  public boolean isEdgeRole() {
    return currentMode() == SyncRuntimeMode.EDGE_ROLE && properties.isEnabled();
  }

  public boolean isCentralRole() {
    return currentMode() == SyncRuntimeMode.CENTRAL_ROLE && properties.isEnabled();
  }

  public boolean isHubRole() {
    return currentMode() == SyncRuntimeMode.HUB_ROLE && properties.isEnabled();
  }
}
