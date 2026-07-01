package com.fern.services.sync.state;

import com.fasterxml.jackson.databind.JsonNode;
import com.fern.services.sync.model.SyncDirection;
import com.fern.services.sync.model.SyncStatus;
import java.util.List;

public interface SyncStateStore {

  List<PendingOutboundEvent> claimPendingOutboundEvents(int limit);

  void markOutboundSent(List<String> eventIds);

  void markOutboundFailed(List<String> eventIds, String errorMessage);

  String readOffset(String nodeId, String streamName);

  void saveOffset(String nodeId, String streamName, String cursor);

  long openSyncLog(String nodeId, long storeId, SyncDirection direction, SyncStatus status, String message);

  void finishSyncLog(long logId, SyncStatus status, int eventCount, String message);

  record PendingOutboundEvent(
      String id,
      String eventType,
      String aggregateType,
      String aggregateId,
      JsonNode payload,
      int retryCount
  ) {
  }
}
