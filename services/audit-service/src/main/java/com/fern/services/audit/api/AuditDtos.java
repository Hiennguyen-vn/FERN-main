package com.fern.services.audit.api;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;

public final class AuditDtos {

  private AuditDtos() {
  }

  public record AuditLogView(
      long id,
      Long actorUserId,
      String action,
      String entityName,
      String entityId,
      String reason,
      JsonNode oldData,
      JsonNode newData,
      String ipAddress,
      String userAgent,
      Instant createdAt
  ) {
  }

  public record SecurityEventView(
      long id,
      Instant createdAt,
      String severity,
      String eventType,
      Long actorUserId,
      String action,
      String entityName,
      String entityId,
      String ipAddress,
      String userAgent,
      String description
  ) {
  }

  public record TraceView(
      long id,
      Instant createdAt,
      String correlationId,
      String method,
      String path,
      Integer statusCode,
      Integer durationMs,
      Long actorUserId,
      String action,
      String entityName,
      String entityId,
      String service,
      String ipAddress,
      String userAgent
  ) {
  }
}
