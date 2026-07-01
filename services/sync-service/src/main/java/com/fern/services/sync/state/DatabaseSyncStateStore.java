package com.fern.services.sync.state;

import com.fern.services.sync.model.SyncDirection;
import com.fern.services.sync.model.SyncStatus;
import java.util.List;
import org.springframework.stereotype.Component;

@Component
public class DatabaseSyncStateStore implements SyncStateStore {

  private final SyncRepository syncRepository;

  public DatabaseSyncStateStore(SyncRepository syncRepository) {
    this.syncRepository = syncRepository;
  }

  @Override
  public List<PendingOutboundEvent> claimPendingOutboundEvents(int limit) {
    return syncRepository.claimPendingLocalOutbox(limit).stream()
        .map(row -> new PendingOutboundEvent(
            row.id(),
            row.eventType(),
            row.aggregateType(),
            row.aggregateId(),
            row.payload(),
            row.retryCount()
        ))
        .toList();
  }

  @Override
  public void markOutboundSent(List<String> eventIds) {
    syncRepository.markLocalOutboxSent(eventIds);
  }

  @Override
  public void markOutboundFailed(List<String> eventIds, String errorMessage) {
    syncRepository.markLocalOutboxFailed(eventIds, errorMessage);
  }

  @Override
  public String readOffset(String nodeId, String streamName) {
    return syncRepository.readSyncOffset(nodeId, streamName);
  }

  @Override
  public void saveOffset(String nodeId, String streamName, String cursor) {
    syncRepository.saveSyncOffset(nodeId, streamName, cursor);
  }

  @Override
  public long openSyncLog(String nodeId, long storeId, SyncDirection direction, SyncStatus status, String message) {
    return syncRepository.openSyncLog(nodeId, storeId, direction.name(), status.name(), message);
  }

  @Override
  public void finishSyncLog(long logId, SyncStatus status, int eventCount, String message) {
    syncRepository.finishSyncLog(logId, status.name(), eventCount, message);
  }
}
