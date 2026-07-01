package com.fern.services.sync.hub.relay;

import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.application.SyncProperties;
import com.fern.services.sync.model.AggregateType;
import com.fern.services.sync.model.SyncDirection;
import com.fern.services.sync.model.SyncStatus;
import com.fern.services.sync.shared.SyncTransportClient;
import com.fern.services.sync.state.RegionalRelayStateStore;
import com.fern.services.sync.tier.SyncTierProfile;
import com.fern.services.sync.tier.SyncTierProfileRegistry;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;

@Service
public class RegionalUpstreamRelayUseCase {

  private final RegionalRelayStateStore regionalRelayStateStore;
  private final SyncTransportClient syncTransportClient;
  private final SyncTierProfileRegistry tierProfileRegistry;
  private final com.fern.services.sync.state.SyncStateStore syncStateStore;
  private final SyncProperties properties;

  public RegionalUpstreamRelayUseCase(
      RegionalRelayStateStore regionalRelayStateStore,
      SyncTransportClient syncTransportClient,
      SyncTierProfileRegistry tierProfileRegistry,
      com.fern.services.sync.state.SyncStateStore syncStateStore,
      SyncProperties properties
  ) {
    this.regionalRelayStateStore = regionalRelayStateStore;
    this.syncTransportClient = syncTransportClient;
    this.tierProfileRegistry = tierProfileRegistry;
    this.syncStateStore = syncStateStore;
    this.properties = properties;
  }

  public int relayToCentral() {
    SyncTierProfile profile = tierProfileRegistry.currentProfile();
    if (!profile.upstreamEnabled()) {
      return 0;
    }
    List<RegionalRelayStateStore.PendingRelayEvent> claimed =
        regionalRelayStateStore.claimPendingRelayEvents(properties.getBatchSize());
    if (claimed.isEmpty()) {
      return 0;
    }

    long logId = syncStateStore.openSyncLog(
        requireNodeId(),
        requireStoreId(),
        SyncDirection.REGION_TO_CENTRAL,
        SyncStatus.PENDING,
        "Relaying accepted hub ingest events to central");

    try {
      Map<RelayBatchKey, List<RegionalRelayStateStore.PendingRelayEvent>> batches = claimed.stream()
          .collect(Collectors.groupingBy(event -> new RelayBatchKey(event.sourceNodeId(), event.sourceStoreId())));

      List<String> sentRelayIds = new ArrayList<>();
      List<String> failedRelayIds = new ArrayList<>();

      for (Map.Entry<RelayBatchKey, List<RegionalRelayStateStore.PendingRelayEvent>> entry : batches.entrySet()) {
        List<RegionalRelayStateStore.PendingRelayEvent> eligible = entry.getValue().stream()
            .filter(event -> profile.pushUpAggregates().contains(AggregateType.valueOf(event.aggregateType())))
            .toList();
        List<RegionalRelayStateStore.PendingRelayEvent> rejected = entry.getValue().stream()
            .filter(event -> !profile.pushUpAggregates().contains(AggregateType.valueOf(event.aggregateType())))
            .toList();

        if (!rejected.isEmpty()) {
          failedRelayIds.addAll(rejected.stream().map(RegionalRelayStateStore.PendingRelayEvent::relayId).toList());
        }
        if (eligible.isEmpty()) {
          continue;
        }

        SyncDtos.SyncUploadResponse response = syncTransportClient.upload(new SyncDtos.SyncUploadRequest(
            entry.getKey().nodeId(),
            entry.getKey().storeId(),
            eligible.stream().map(event -> new SyncDtos.SyncEvent(
                event.relayId(),
                com.fern.services.sync.model.EventType.valueOf(event.eventType()),
                AggregateType.valueOf(event.aggregateType()),
                event.aggregateId(),
                event.version(),
                event.occurredAt(),
                event.payload()
            )).toList()
        ));

        sentRelayIds.addAll(response.accepted());
        sentRelayIds.addAll(response.duplicated());
        failedRelayIds.addAll(response.rejected().stream().map(SyncDtos.RejectedEvent::eventId).toList());
      }

      regionalRelayStateStore.markRelaySent(sentRelayIds);
      regionalRelayStateStore.markRelayFailed(failedRelayIds, "Rejected by central sync-service");
      syncStateStore.finishSyncLog(
          logId,
          failedRelayIds.isEmpty() ? SyncStatus.SENT : SyncStatus.FAILED,
          claimed.size(),
          failedRelayIds.isEmpty() ? "Region relay completed" : "Region relay completed with failures");
      return sentRelayIds.size();
    } catch (Exception e) {
      regionalRelayStateStore.markRelayFailed(
          claimed.stream().map(RegionalRelayStateStore.PendingRelayEvent::relayId).toList(),
          e.getMessage());
      syncStateStore.finishSyncLog(logId, SyncStatus.FAILED, claimed.size(), e.getMessage());
      return 0;
    }
  }

  private String requireNodeId() {
    if (properties.getNodeId() == null || properties.getNodeId().isBlank()) {
      throw new IllegalStateException("sync.node-id is required for regional relay");
    }
    return properties.getNodeId();
  }

  private long requireStoreId() {
    if (properties.getStoreId() == null || properties.getStoreId().isBlank()) {
      throw new IllegalStateException("sync.store-id is required for regional relay");
    }
    return Long.parseLong(properties.getStoreId());
  }

  private record RelayBatchKey(String nodeId, long storeId) {
  }
}
