package com.dorabets.common.spring.web;

import com.dorabets.common.middleware.ServiceException;
import java.util.Locale;
import java.util.Set;

public final class QueryConventions {

  private QueryConventions() {
  }

  public static int sanitizeLimit(Integer limit, int defaultLimit, int maxLimit) {
    if (defaultLimit <= 0 || maxLimit <= 0 || defaultLimit > maxLimit) {
      throw new IllegalArgumentException("Invalid pagination defaults");
    }
    if (limit == null || limit <= 0) {
      return defaultLimit;
    }
    return Math.min(limit, maxLimit);
  }

  public static int sanitizeOffset(Integer offset) {
    if (offset == null || offset < 0) {
      return 0;
    }
    return offset;
  }

  public static String normalizeSortDir(String sortDir) {
    if (sortDir == null || sortDir.isBlank()) {
      return "desc";
    }
    String normalized = sortDir.trim().toLowerCase(Locale.ROOT);
    if (!"asc".equals(normalized) && !"desc".equals(normalized)) {
      throw ServiceException.badRequest("sortDir must be 'asc' or 'desc'");
    }
    return normalized;
  }

  public static String normalizeSortBy(String sortBy, Set<String> allowedSortKeys, String defaultSortBy) {
    String chosen = sortBy == null || sortBy.isBlank() ? defaultSortBy : sortBy.trim();
    if (chosen == null || chosen.isBlank()) {
      throw new IllegalArgumentException("defaultSortBy is required");
    }
    if (allowedSortKeys != null && !allowedSortKeys.isEmpty() && !allowedSortKeys.contains(chosen)) {
      throw ServiceException.badRequest(
          "sortBy must be one of: " + String.join(", ", allowedSortKeys));
    }
    return chosen;
  }

  public static String normalizeQuery(String q) {
    if (q == null) {
      return null;
    }
    String trimmed = q.trim();
    return trimmed.isEmpty() ? null : trimmed;
  }
}
