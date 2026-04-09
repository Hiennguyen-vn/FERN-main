package com.dorabets.common.spring.auth;

import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.Set;

public record JwtClaims(
    Long userId,
    String username,
    String sessionId,
    Set<String> roles,
    Set<String> permissions,
    Set<Long> outletIds,
    Instant issuedAt,
    Instant expiresAt
) {

  public JwtClaims {
    roles = roles == null ? Set.of() : Set.copyOf(new LinkedHashSet<>(roles));
    permissions = permissions == null ? Set.of() : Set.copyOf(new LinkedHashSet<>(permissions));
    outletIds = outletIds == null ? Set.of() : Set.copyOf(new LinkedHashSet<>(outletIds));
  }

  public boolean isExpired(Instant now) {
    return expiresAt != null && expiresAt.isBefore(now);
  }
}
