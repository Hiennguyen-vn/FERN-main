package com.dorabets.common.spring.auth;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

public record BusinessUserProfile(
    long userId,
    Set<CanonicalRole> canonicalRoles,
    List<BusinessScopeAssignment> assignments,
    Set<Long> outletIds
) {

  public BusinessUserProfile {
    canonicalRoles = canonicalRoles == null ? Set.of() : Set.copyOf(new LinkedHashSet<>(canonicalRoles));
    assignments = assignments == null ? List.of() : List.copyOf(assignments);
    outletIds = outletIds == null ? Set.of() : Set.copyOf(new LinkedHashSet<>(outletIds));
  }

  public boolean hasGlobalRole(CanonicalRole role) {
    return assignments.stream()
        .anyMatch(assignment -> assignment.role() == role && assignment.scopeType() == ScopeType.GLOBAL);
  }

  public boolean hasRoleForOutlet(CanonicalRole role, long outletId) {
    return assignments.stream()
        .filter(assignment -> assignment.role() == role)
        .anyMatch(assignment -> assignment.scopeType() == ScopeType.GLOBAL || assignment.outletIds().contains(outletId));
  }

  public boolean hasRoleForRegion(long regionId, CanonicalRole role) {
    return assignments.stream()
        .filter(assignment -> assignment.role() == role)
        .anyMatch(assignment ->
            assignment.scopeType() == ScopeType.GLOBAL
                || (assignment.scopeType() == ScopeType.REGION && assignment.scopeId() != null && assignment.scopeId() == regionId)
        );
  }

  public boolean hasRoleForRegionCode(String regionCode, CanonicalRole role) {
    if (regionCode == null || regionCode.isBlank()) {
      return false;
    }
    return assignments.stream()
        .filter(assignment -> assignment.role() == role)
        .anyMatch(assignment ->
            assignment.scopeType() == ScopeType.GLOBAL
                || (assignment.scopeType() == ScopeType.REGION && regionCode.equalsIgnoreCase(assignment.scopeCode()))
        );
  }

  public Set<Long> outletsForRole(CanonicalRole role) {
    LinkedHashSet<Long> result = new LinkedHashSet<>();
    assignments.stream()
        .filter(assignment -> assignment.role() == role)
        .forEach(assignment -> result.addAll(assignment.outletIds()));
    return Set.copyOf(result);
  }

  public Set<Long> regionIdsForRole(CanonicalRole role) {
    LinkedHashSet<Long> result = new LinkedHashSet<>();
    assignments.stream()
        .filter(assignment -> assignment.role() == role && assignment.scopeType() == ScopeType.REGION && assignment.scopeId() != null)
        .map(BusinessScopeAssignment::scopeId)
        .forEach(result::add);
    return Set.copyOf(result);
  }
}
