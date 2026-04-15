package com.fern.services.product.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.Instant;

public final class PublishDtos {

  private PublishDtos() {}

  public record PublishVersionView(
      long id,
      String name,
      String description,
      String status,
      Long createdByUserId,
      Instant submittedAt,
      Instant reviewedAt,
      Long reviewedByUserId,
      String reviewNote,
      Instant scheduledAt,
      Instant publishedAt,
      Instant rolledBackAt,
      String rollbackReason,
      int itemCount,
      Instant createdAt
  ) {}

  public record PublishItemView(
      long id,
      String entityType,
      long entityId,
      String changeType,
      String scopeType,
      String scopeId,
      String summary,
      String beforeSnapshot,
      String afterSnapshot,
      Instant createdAt
  ) {}

  public record CreatePublishVersionRequest(
      @NotBlank String name,
      String description
  ) {}

  public record AddPublishItemRequest(
      @NotBlank String entityType,
      @NotNull Long entityId,
      @NotBlank String changeType,
      String scopeType,
      String scopeId,
      @NotBlank String summary,
      String beforeSnapshot,
      String afterSnapshot
  ) {}

  public record SubmitReviewRequest(String note) {}

  public record ReviewDecisionRequest(
      @NotBlank String decision,
      String note
  ) {}

  public record SchedulePublishRequest(
      @NotNull Instant scheduledAt
  ) {}

  public record RollbackRequest(String reason) {}

  public record AuditLogView(
      long id,
      String entityType,
      long entityId,
      String action,
      String fieldName,
      String oldValue,
      String newValue,
      String scopeType,
      String scopeId,
      Long userId,
      String username,
      Long publishVersionId,
      Instant createdAt
  ) {}
}
