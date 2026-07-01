package com.fern.services.sync.orchestration;

import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.apply.SyncEventApplier;
import com.fern.services.sync.application.SyncProperties;
import com.fern.services.sync.model.AggregateType;
import com.fern.services.sync.model.EventType;
import com.fern.services.sync.model.SyncDirection;
import com.fern.services.sync.model.SyncStatus;
import com.fern.services.sync.shared.SyncTransportClient;
import com.fern.services.sync.state.SyncStateStore;
import com.fern.services.sync.tier.SyncTierProfile;
import com.fern.services.sync.tier.SyncTierProfileRegistry;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.Clock;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class TieredSyncOrchestrator {

  private static final Logger log = LoggerFactory.getLogger(TieredSyncOrchestrator.class);

  private final SyncStateStore syncStateStore;
  private final SyncTransportClient syncTransportClient;
  private final SyncEventApplier syncEventApplier;
  private final SyncTierProfileRegistry tierProfileRegistry;
  private final SyncProperties properties;
  private final Clock clock;
  private final Counter uploadSuccessCounter;
  private final Counter uploadFailureCounter;
  private final Counter downloadAppliedCounter;
  private final Counter downloadConflictCounter;

  public TieredSyncOrchestrator(
      SyncStateStore syncStateStore,
      SyncTransportClient syncTransportClient,
      SyncEventApplier syncEventApplier,
      SyncTierProfileRegistry tierProfileRegistry,
      SyncProperties properties,
      Clock clock,
      MeterRegistry meterRegistry
  ) {
    this.syncStateStore = syncStateStore;
    this.syncTransportClient = syncTransportClient;
    this.syncEventApplier = syncEventApplier;
    this.tierProfileRegistry = tierProfileRegistry;
    this.properties = properties;
    this.clock = clock;
    this.uploadSuccessCounter = meterRegistry.counter("sync.store.upload.events", "status", "sent");
    this.uploadFailureCounter = meterRegistry.counter("sync.store.upload.events", "status", "failed");
    this.downloadAppliedCounter = meterRegistry.counter("sync.store.download.events", "status", "applied");
    this.downloadConflictCounter = meterRegistry.counter("sync.store.download.events", "status", "conflict");
  }

  public int syncUp() {
    SyncTierProfile profile = tierProfileRegistry.currentProfile();
    if (!profile.upstreamEnabled()) {
      return 0;
    }
    List<SyncStateStore.PendingOutboundEvent> pending = syncStateStore.claimPendingOutboundEvents(properties.getBatchSize());
    if (pending.isEmpty()) {
      return 0;
    }
    List<SyncStateStore.PendingOutboundEvent> eligible = pending.stream()
        .filter(row -> profile.pushUpAggregates().contains(AggregateType.valueOf(row.aggregateType())))
        .toList();
    if (eligible.isEmpty()) {
      return 0;
    }
    List<String> eventIds = eligible.stream().map(SyncStateStore.PendingOutboundEvent::id).toList();
    long logId = syncStateStore.openSyncLog(
        requireNodeId(),
        requireStoreId(),
        SyncDirection.STORE_TO_CENTRAL,
        SyncStatus.PENDING,
        "Uploading tiered sync events");
    try {
      SyncDtos.SyncUploadResponse response = syncTransportClient.upload(new SyncDtos.SyncUploadRequest(
          requireNodeId(),
          requireStoreId(),
          eligible.stream().map(this::toSyncEvent).toList()
      ));
      List<String> sent = new ArrayList<>();
      sent.addAll(response.accepted());
      sent.addAll(response.duplicated());
      syncStateStore.markOutboundSent(sent);
      List<String> rejected = response.rejected().stream().map(SyncDtos.RejectedEvent::eventId).toList();
      syncStateStore.markOutboundFailed(rejected, "Rejected by upstream sync-service");
      uploadSuccessCounter.increment(sent.size());
      if (!rejected.isEmpty()) {
        uploadFailureCounter.increment(rejected.size());
      }
      syncStateStore.finishSyncLog(
          logId,
          rejected.isEmpty() ? SyncStatus.SENT : SyncStatus.FAILED,
          eligible.size(),
          rejected.isEmpty() ? "Sync up completed" : "Sync up completed with rejected events");
      return sent.size();
    } catch (Exception e) {
      log.warn("Tiered sync up failed for {} events: {}", eligible.size(), e.getMessage());
      syncStateStore.markOutboundFailed(eventIds, e.getMessage());
      uploadFailureCounter.increment(eventIds.size());
      syncStateStore.finishSyncLog(logId, SyncStatus.FAILED, eligible.size(), e.getMessage());
      return 0;
    }
  }

  public int syncDown() {
    SyncTierProfile profile = tierProfileRegistry.currentProfile();
    if (!profile.downstreamEnabled()) {
      return 0;
    }
    String nodeId = requireNodeId();
    long storeId = requireStoreId();
    String streamName = "central-outbox";
    String cursor = syncStateStore.readOffset(nodeId, streamName);
    long logId = syncStateStore.openSyncLog(
        nodeId,
        storeId,
        SyncDirection.CENTRAL_TO_STORE,
        SyncStatus.PENDING,
        "Downloading tiered sync events");
    try {
      SyncDtos.SyncDownloadResponse response = syncTransportClient.download(storeId, cursor, properties.getBatchSize());
      if (response == null || response.events() == null || response.events().isEmpty()) {
        syncStateStore.finishSyncLog(logId, SyncStatus.SENT, 0, "No downstream events available");
        return 0;
      }

      List<SyncDtos.SyncAckItem> ackItems = new ArrayList<>();
      int appliedCount = 0;
      for (SyncDtos.SyncDownloadEvent event : response.events()) {
        SyncDtos.SyncEvent syncEvent = event.toSyncEvent();
        if (!profile.pullDownAggregates().contains(syncEvent.aggregateType())) {
          ackItems.add(new SyncDtos.SyncAckItem(
              syncEvent.eventId(),
              SyncStatus.REJECTED,
              "Aggregate not enabled for tier " + profile.tier()));
          continue;
        }
        boolean applied = syncEventApplier.apply(syncEvent);
        if (applied) {
          appliedCount++;
          downloadAppliedCounter.increment();
          ackItems.add(new SyncDtos.SyncAckItem(syncEvent.eventId(), SyncStatus.APPLIED, null));
        } else {
          downloadConflictCounter.increment();
          ackItems.add(new SyncDtos.SyncAckItem(
              syncEvent.eventId(),
              SyncStatus.REJECTED,
              "Skipped or conflicted during local apply"));
        }
      }

      syncTransportClient.ack(new SyncDtos.SyncAckRequest(nodeId, storeId, ackItems));
      syncStateStore.saveOffset(nodeId, streamName, response.nextCursor());
      syncStateStore.finishSyncLog(
          logId,
          SyncStatus.SENT,
          response.events().size(),
          "Sync down completed, applied " + appliedCount + " events");
      return response.events().size();
    } catch (Exception e) {
      syncStateStore.finishSyncLog(logId, SyncStatus.FAILED, 0, e.getMessage());
      throw e;
    }
  }

  private SyncDtos.SyncEvent toSyncEvent(SyncStateStore.PendingOutboundEvent row) {
    return new SyncDtos.SyncEvent(
        row.id(),
        EventType.valueOf(row.eventType()),
        AggregateType.valueOf(row.aggregateType()),
        row.aggregateId(),
        1L,
        clock.instant(),
        row.payload()
    );
  }

  private String requireNodeId() {
    if (properties.getNodeId() == null || properties.getNodeId().isBlank()) {
      throw new IllegalStateException("sync.node-id is required for downstream-capable tiers");
    }
    return properties.getNodeId();
  }

  private long requireStoreId() {
    if (properties.getStoreId() == null || properties.getStoreId().isBlank()) {
      throw new IllegalStateException("sync.store-id is required for downstream-capable tiers");
    }
    return Long.parseLong(properties.getStoreId());
  }
}
