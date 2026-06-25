package com.fern.services.sync.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.fern.services.sync.model.AggregateType;
import com.fern.services.sync.model.EventType;
import com.fern.services.sync.model.SyncStatus;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import java.time.Instant;
import java.util.List;

public final class SyncDtos {

  private SyncDtos() {
  }

  public record SyncEvent(
      @NotBlank String eventId,
      @NotNull EventType eventType,
      @NotNull AggregateType aggregateType,
      @NotBlank String aggregateId,
      @Positive long version,
      @NotNull Instant occurredAt,
      @NotNull JsonNode payload
  ) {
  }

  public record SyncUploadRequest(
      @NotBlank String nodeId,
      @NotNull Long storeId,
      @Valid @NotNull List<SyncEvent> events
  ) {
  }

  public record RejectedEvent(
      String eventId,
      String reason
  ) {
  }

  public record SyncUploadResponse(
      List<String> accepted,
      List<String> duplicated,
      List<RejectedEvent> rejected
  ) {
  }

  public record SyncDownloadResponse(
      List<SyncEvent> events,
      String nextCursor,
      boolean hasMore
  ) {
  }

  public record SyncAckItem(
      @NotBlank String eventId,
      @NotNull SyncStatus status,
      String errorMessage
  ) {
  }

  public record SyncAckRequest(
      @NotBlank String nodeId,
      @NotNull Long storeId,
      @Valid @NotNull List<SyncAckItem> events
  ) {
  }

  public record SyncStatusResponse(
      long storeId,
      Instant lastUploadAt,
      Instant lastDownloadAt,
      long pendingUploadCount,
      long pendingDownloadCount,
      long failedEventCount,
      Instant lastSeenAt
  ) {
  }

  public record CentralOutboxPublishRequest(
      @NotNull EventType eventType,
      @NotNull AggregateType aggregateType,
      @NotBlank String aggregateId,
      @NotNull JsonNode payload,
      Long targetStoreId,
      Long targetStoreGroupId,
      Long version
  ) {
  }

  public record ProvisionSyncNodeRequest(
      @NotNull Long storeId,
      @NotBlank String nodeCode,
      @NotBlank String nodeName,
      String nodeType,
      Integer workerId,
      String hardwareFingerprint,
      String publicKey
  ) {
  }

  public record ProvisionSyncNodeResponse(
      String nodeId,
      long storeId,
      String nodeCode,
      long deviceId,
      int workerId,
      String clientSecret
  ) {
  }

  public record RotateSyncNodeSecretResponse(
      String nodeId,
      long storeId,
      long deviceId,
      String clientSecret
  ) {
  }

  public record SyncHandshakeRequest(
      @NotBlank String nodeId,
      @NotNull Long storeId,
      @NotBlank String clientSecret
  ) {
  }

  public record SyncHandshakeResponse(
      String nodeId,
      long storeId,
      long deviceId,
      String accessToken,
      long tokenTtlSeconds,
      Instant expiresAt
  ) {
  }
}
