package com.fern.common.spring.auth;

import com.fern.common.middleware.ServiceException;
import java.util.LinkedHashSet;
import java.util.Set;

public record RequestUserContext(
    Long userId,
    String username,
    String sessionId,
    Set<String> roles,
    Set<String> permissions,
    Set<Long> outletIds,
    boolean authenticated,
    boolean internalService,
    String callerService,
    Long deviceId,
    Long deviceOutletId
) {

  public RequestUserContext {
    roles = roles == null ? Set.of() : Set.copyOf(new LinkedHashSet<>(roles));
    permissions = permissions == null ? Set.of() : Set.copyOf(new LinkedHashSet<>(permissions));
    outletIds = outletIds == null ? Set.of() : Set.copyOf(new LinkedHashSet<>(outletIds));
  }

  public static RequestUserContext anonymous() {
    return new RequestUserContext(null, null, null, Set.of(), Set.of(), Set.of(), false, false, null, null, null);
  }

  public boolean isDeviceContext() {
    return deviceId != null && deviceOutletId != null;
  }

  public long requireUserId() {
    if (userId == null) {
      throw ServiceException.unauthorized("Authentication required");
    }
    return userId;
  }

  public boolean hasRole(String role) {
    return roles.contains(role);
  }

  public boolean hasPermission(String permission) {
    return permissions.contains(permission);
  }
}
