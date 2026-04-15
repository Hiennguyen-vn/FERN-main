package com.dorabets.common.spring.auth;

import java.util.LinkedHashSet;
import java.util.Set;

public record BusinessScopeAssignment(
    CanonicalRole role,
    ScopeType scopeType,
    Long scopeId,
    String scopeCode,
    Set<Long> outletIds,
    Set<String> sourceRoleCodes
) {

  public BusinessScopeAssignment {
    outletIds = outletIds == null ? Set.of() : Set.copyOf(new LinkedHashSet<>(outletIds));
    sourceRoleCodes = sourceRoleCodes == null ? Set.of() : Set.copyOf(new LinkedHashSet<>(sourceRoleCodes));
  }
}
