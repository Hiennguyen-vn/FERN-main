package com.fern.services.sync.state;

import com.fasterxml.jackson.databind.JsonNode;
import com.fern.services.sync.api.SyncDtos;
import java.time.Instant;
import java.util.List;

public interface RegionalRelayStateStore {

  void enqueueAcceptedRelayCandidate(String nodeId, long storeId, SyncDtos.SyncEvent event);

  List<PendingRelayEvent> claimPendingRelayEvents(int limit);

  void markRelaySent(List<String> relayIds);

  void markRelayFailed(List<String> relayIds, String errorMessage);

  record PendingRelayEvent(
      String relayId,
      String sourceNodeId,
      long sourceStoreId,
      String eventType,
      String aggregateType,
      String aggregateId,
      JsonNode payload,
      long version,
      Instant occurredAt,
      int retryCount
  ) {
  }
}
