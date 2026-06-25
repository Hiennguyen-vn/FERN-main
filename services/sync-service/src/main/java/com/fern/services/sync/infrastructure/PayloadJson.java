package com.fern.services.sync.infrastructure;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;

final class PayloadJson {

  private PayloadJson() {
  }

  static String text(JsonNode payload, String field, String fallback) {
    JsonNode node = payload == null ? null : payload.get(field);
    if (node == null || node.isNull()) {
      return fallback;
    }
    String value = node.asText();
    return value == null || value.isBlank() ? fallback : value;
  }

  static Long longValue(JsonNode payload, String field, Long fallback) {
    JsonNode node = payload == null ? null : payload.get(field);
    if (node == null || node.isNull()) {
      return fallback;
    }
    if (node.canConvertToLong()) {
      return node.longValue();
    }
    try {
      return Long.parseLong(node.asText());
    } catch (Exception ignored) {
      return fallback;
    }
  }

  static int intValue(JsonNode payload, String field, int fallback) {
    JsonNode node = payload == null ? null : payload.get(field);
    if (node == null || node.isNull()) {
      return fallback;
    }
    if (node.canConvertToInt()) {
      return node.intValue();
    }
    try {
      return Integer.parseInt(node.asText());
    } catch (Exception ignored) {
      return fallback;
    }
  }

  static BigDecimal decimal(JsonNode payload, String field, BigDecimal fallback) {
    JsonNode node = payload == null ? null : payload.get(field);
    if (node == null || node.isNull()) {
      return fallback;
    }
    if (node.isNumber()) {
      return node.decimalValue();
    }
    try {
      return new BigDecimal(node.asText());
    } catch (Exception ignored) {
      return fallback;
    }
  }

  static Boolean bool(JsonNode payload, String field, Boolean fallback) {
    JsonNode node = payload == null ? null : payload.get(field);
    if (node == null || node.isNull()) {
      return fallback;
    }
    if (node.isBoolean()) {
      return node.booleanValue();
    }
    return Boolean.parseBoolean(node.asText());
  }

  static LocalDate date(JsonNode payload, String field, LocalDate fallback) {
    String value = text(payload, field, null);
    if (value == null) {
      return fallback;
    }
    return LocalDate.parse(value);
  }

  static Instant instant(JsonNode payload, String field, Instant fallback) {
    String value = text(payload, field, null);
    if (value == null) {
      return fallback;
    }
    return Instant.parse(value);
  }
}
