package com.dorabets.common.spring.auth;

import java.util.LinkedHashSet;
import java.util.Set;

public record AuthorizationDecision(
    boolean allowed,
    String reasonCode,
    String matchedBy,
    Set<Long> effectiveOutletIds
) {

  public AuthorizationDecision {
    effectiveOutletIds = effectiveOutletIds == null ? Set.of() : Set.copyOf(new LinkedHashSet<>(effectiveOutletIds));
  }

  public static AuthorizationDecision allow(String matchedBy, Set<Long> outletIds) {
    return new AuthorizationDecision(true, "allowed", matchedBy, outletIds);
  }

  public static AuthorizationDecision deny(String reasonCode) {
    return new AuthorizationDecision(false, reasonCode, null, Set.of());
  }
}
