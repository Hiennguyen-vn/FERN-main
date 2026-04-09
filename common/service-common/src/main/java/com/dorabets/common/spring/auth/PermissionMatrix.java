package com.dorabets.common.spring.auth;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

public record PermissionMatrix(
    long userId,
    Map<Long, Set<String>> permissionsByOutlet,
    Map<Long, Set<String>> rolesByOutlet
) {

  public PermissionMatrix {
    permissionsByOutlet = immutableNested(permissionsByOutlet);
    rolesByOutlet = immutableNested(rolesByOutlet);
  }

  public boolean hasPermission(long outletId, String permissionCode) {
    return permissionsByOutlet.getOrDefault(outletId, Set.of()).contains(permissionCode);
  }

  public Set<String> permissionsForOutlet(long outletId) {
    return permissionsByOutlet.getOrDefault(outletId, Set.of());
  }

  public Set<String> rolesForOutlet(long outletId) {
    return rolesByOutlet.getOrDefault(outletId, Set.of());
  }

  private static Map<Long, Set<String>> immutableNested(Map<Long, Set<String>> source) {
    if (source == null || source.isEmpty()) {
      return Map.of();
    }
    Map<Long, Set<String>> copy = new LinkedHashMap<>();
    source.forEach((key, value) -> copy.put(key, value == null ? Set.of() : Set.copyOf(new LinkedHashSet<>(value))));
    return Map.copyOf(copy);
  }
}
