package com.dorabets.common.spring.auth;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

@Component
public class RoleAliasResolver {

  private final Map<String, CanonicalRole> aliases = new LinkedHashMap<>();

  public RoleAliasResolver() {
    alias("superadmin", CanonicalRole.SUPERADMIN);
    alias("admin", CanonicalRole.ADMIN);
    alias("system_admin", CanonicalRole.ADMIN);
    alias("technical_admin", CanonicalRole.ADMIN);
    alias("regional_manager", CanonicalRole.REGION_MANAGER);
    alias("region_manager", CanonicalRole.REGION_MANAGER);
    alias("outlet_manager", CanonicalRole.OUTLET_MANAGER);
    alias("cashier", CanonicalRole.STAFF);
    alias("staff_pos", CanonicalRole.STAFF);
    alias("staff", CanonicalRole.STAFF);
    alias("product_manager", CanonicalRole.PRODUCT_MANAGER);
    alias("procurement_officer", CanonicalRole.PROCUREMENT);
    alias("procurement", CanonicalRole.PROCUREMENT);
    alias("finance", CanonicalRole.FINANCE);
    alias("finance_manager", CanonicalRole.FINANCE);
    alias("finance_approver", CanonicalRole.FINANCE);
    alias("regional_finance", CanonicalRole.FINANCE);
    alias("accountant", CanonicalRole.FINANCE);
    alias("kitchen_staff", CanonicalRole.KITCHEN_STAFF);
    alias("hr", CanonicalRole.HR);
    alias("hr_manager", CanonicalRole.HR);
  }

  public Optional<CanonicalRole> toCanonicalRole(String roleCode) {
    if (roleCode == null || roleCode.isBlank()) {
      return Optional.empty();
    }
    return Optional.ofNullable(aliases.get(normalize(roleCode)));
  }

  public String toStoredRoleCode(String requestedRoleCode) {
    return toCanonicalRole(requestedRoleCode)
        .map(CanonicalRole::storedRoleCode)
        .orElseGet(() -> requestedRoleCode == null ? null : requestedRoleCode.trim());
  }

  public Set<String> aliasesFor(CanonicalRole canonicalRole) {
    return aliases.entrySet().stream()
        .filter(entry -> entry.getValue() == canonicalRole)
        .map(Map.Entry::getKey)
        .collect(Collectors.toCollection(java.util.LinkedHashSet::new));
  }

  private void alias(String roleCode, CanonicalRole canonicalRole) {
    aliases.put(normalize(roleCode), canonicalRole);
  }

  private String normalize(String value) {
    return value.trim().toLowerCase(Locale.ROOT);
  }
}
