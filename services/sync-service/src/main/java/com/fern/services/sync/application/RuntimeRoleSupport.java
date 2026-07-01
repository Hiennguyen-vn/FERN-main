package com.fern.services.sync.application;

final class RuntimeRoleSupport {

  private RuntimeRoleSupport() {
  }

  static boolean isStoreRole(SyncProperties properties) {
    return properties.isEnabled() && (
        properties.effectiveRole() == SyncProperties.SyncRuntimeRole.OUTLET_EDGE
            || properties.effectiveRole() == SyncProperties.SyncRuntimeRole.REGIONAL_HUB
    );
  }

  static boolean isCentralRole(SyncProperties properties) {
    return properties.isEnabled() && properties.effectiveRole() == SyncProperties.SyncRuntimeRole.MASTER_CENTRAL;
  }

  static boolean isHubRole(SyncProperties properties) {
    return properties.isEnabled() && properties.effectiveRole() == SyncProperties.SyncRuntimeRole.REGIONAL_HUB;
  }
}
