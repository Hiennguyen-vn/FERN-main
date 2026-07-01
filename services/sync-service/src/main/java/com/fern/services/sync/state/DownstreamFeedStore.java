package com.fern.services.sync.state;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.List;

public interface DownstreamFeedStore {

  long appendDownstreamEvent(
      String sourceNodeId,
      String eventType,
      String aggregateType,
      String aggregateId,
      String targetScope,
      Long targetStoreId,
      Long targetStoreGroupId,
      String targetNodeId,
      JsonNode payload,
      long version
  );

  List<DownstreamEvent> readDownstreamEvents(String targetNodeId, Long targetStoreId, long cursor, int limit);

  void recordDownstreamAck(String eventId, String nodeId, Long storeId, String status, String errorMessage);

  record DownstreamEvent(
      long id,
      String eventType,
      String aggregateType,
      String aggregateId,
      JsonNode payload,
      long version,
      Instant createdAt,
      String targetScope,
      Long targetStoreId,
      Long targetStoreGroupId
  ) {
  }
}
