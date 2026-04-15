package com.dorabets.common.spring.auth;

import java.util.Arrays;
import java.util.Optional;

public enum CanonicalRole {
  SUPERADMIN("superadmin", "superadmin", "Superadmin", ScopeType.GLOBAL),
  ADMIN("admin", "admin", "Admin", ScopeType.OUTLET),
  REGION_MANAGER("region_manager", "region_manager", "Region Manager", ScopeType.REGION),
  OUTLET_MANAGER("outlet_manager", "outlet_manager", "Outlet Manager", ScopeType.OUTLET),
  STAFF("staff", "cashier", "Staff", ScopeType.OUTLET),
  PRODUCT_MANAGER("product_manager", "product_manager", "Product Manager", ScopeType.REGION),
  PROCUREMENT("procurement", "procurement_officer", "Procurement", ScopeType.OUTLET),
  FINANCE("finance", "finance", "Finance", ScopeType.REGION),
  KITCHEN_STAFF("kitchen_staff", "kitchen_staff", "Kitchen Staff", ScopeType.OUTLET),
  HR("hr", "hr", "HR", ScopeType.REGION);

  private final String code;
  private final String storedRoleCode;
  private final String displayName;
  private final ScopeType defaultScopeType;

  CanonicalRole(String code, String storedRoleCode, String displayName, ScopeType defaultScopeType) {
    this.code = code;
    this.storedRoleCode = storedRoleCode;
    this.displayName = displayName;
    this.defaultScopeType = defaultScopeType;
  }

  public String code() {
    return code;
  }

  public String storedRoleCode() {
    return storedRoleCode;
  }

  public String displayName() {
    return displayName;
  }

  public ScopeType defaultScopeType() {
    return defaultScopeType;
  }

  public boolean regionScoped() {
    return this == ADMIN
        || this == REGION_MANAGER
        || this == PRODUCT_MANAGER
        || this == FINANCE
        || this == HR;
  }

  public static Optional<CanonicalRole> fromCode(String value) {
    if (value == null || value.isBlank()) {
      return Optional.empty();
    }
    return Arrays.stream(values())
        .filter(role -> role.code.equalsIgnoreCase(value.trim()))
        .findFirst();
  }
}
