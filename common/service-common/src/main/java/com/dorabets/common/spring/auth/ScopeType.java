package com.dorabets.common.spring.auth;

import com.dorabets.common.middleware.ServiceException;
import java.util.Locale;

public enum ScopeType {
  GLOBAL("global"),
  REGION("region"),
  OUTLET("outlet");

  private final String code;

  ScopeType(String code) {
    this.code = code;
  }

  public String code() {
    return code;
  }

  public static ScopeType fromCode(String value) {
    if (value == null || value.isBlank()) {
      throw ServiceException.badRequest("scopeType is required");
    }
    String normalized = value.trim().toLowerCase(Locale.ROOT);
    return switch (normalized) {
      case "global" -> GLOBAL;
      case "region" -> REGION;
      case "outlet" -> OUTLET;
      default -> throw ServiceException.badRequest("Unsupported scopeType: " + value);
    };
  }
}
