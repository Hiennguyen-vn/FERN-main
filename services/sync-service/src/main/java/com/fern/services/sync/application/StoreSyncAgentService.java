package com.fern.services.sync.application;

import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.infrastructure.SyncRepository;
import com.fern.services.sync.model.AggregateType;
import com.fern.services.sync.model.EventType;
import java.time.Clock;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class StoreSyncAgentService {

  private static final Logger log = LoggerFactory.getLogger(StoreSyncAgentService.class);

  private final SyncRepository syncRepository;
  private final CentralSyncClient centralSyncClient;
  private final SyncProperties properties;
  private final Clock clock;

  public StoreSyncAgentService(
      SyncRepository syncRepository,
      CentralSyncClient centralSyncClient,
      SyncProperties properties,
      Clock clock
  ) {
    this.syncRepository = syncRepository;
    this.centralSyncClient = centralSyncClient;
    this.properties = properties;
    this.clock = clock;
  }

  public int uploadPendingEvents() {
    List<SyncRepository.LocalOutboxRow> pending = syncRepository.claimPendingLocalOutbox(properties.getBatchSize());
    if (pending.isEmpty()) {
      return 0;
    }
    List<String> eventIds = pending.stream().map(SyncRepository.LocalOutboxRow::id).toList();
    try {
      SyncDtos.SyncUploadResponse response = centralSyncClient.upload(new SyncDtos.SyncUploadRequest(
          requireNodeId(),
          requireStoreId(),
          pending.stream().map(this::toSyncEvent).toList()
      ));
      List<String> sent = new ArrayList<>();
      sent.addAll(response.accepted());
      sent.addAll(response.duplicated());
      syncRepository.markLocalOutboxSent(sent);
      List<String> rejected = response.rejected().stream().map(SyncDtos.RejectedEvent::eventId).toList();
      syncRepository.markLocalOutboxFailed(rejected, "Rejected by central sync-service");
      return sent.size();
    } catch (Exception e) {
      log.warn("Store sync upload failed for {} events: {}", pending.size(), e.getMessage());
      syncRepository.markLocalOutboxFailed(eventIds, e.getMessage());
      return 0;
    }
  }

  private SyncDtos.SyncEvent toSyncEvent(SyncRepository.LocalOutboxRow row) {
    return new SyncDtos.SyncEvent(
        row.id(),
        EventType.valueOf(row.eventType()),
        AggregateType.valueOf(row.aggregateType()),
        row.aggregateId(),
        Math.max(1L, row.retryCount() + 1L),
        clock.instant(),
        row.payload()
    );
  }

  private String requireNodeId() {
    if (properties.getNodeId() == null || properties.getNodeId().isBlank()) {
      throw new IllegalStateException("SYNC_NODE_ID is required in STORE sync mode");
    }
    return properties.getNodeId();
  }

  private long requireStoreId() {
    if (properties.getStoreId() == null || properties.getStoreId().isBlank()) {
      throw new IllegalStateException("SYNC_STORE_ID is required in STORE sync mode");
    }
    return Long.parseLong(properties.getStoreId());
  }
}
