package com.fern.services.sync.hub.forwarding;

import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.application.SyncProperties;
import com.fern.services.sync.model.SyncDirection;
import com.fern.services.sync.model.SyncStatus;
import com.fern.services.sync.shared.SyncTransportClient;
import com.fern.services.sync.state.DownstreamFeedStore;
import com.fern.services.sync.state.SyncStateStore;
import com.fern.services.sync.tier.SyncTierProfile;
import com.fern.services.sync.tier.SyncTierProfileRegistry;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class RegionalCentralForwardingUseCase {

  static final String FORWARDING_STREAM = "central-forwarding-outbox";

  private final SyncTransportClient syncTransportClient;
  private final SyncStateStore syncStateStore;
  private final DownstreamFeedStore downstreamFeedStore;
  private final DownstreamFanoutPlanner fanoutPlanner;
  private final SyncTierProfileRegistry tierProfileRegistry;
  private final SyncProperties properties;

  public RegionalCentralForwardingUseCase(
      SyncTransportClient syncTransportClient,
      SyncStateStore syncStateStore,
      DownstreamFeedStore downstreamFeedStore,
      DownstreamFanoutPlanner fanoutPlanner,
      SyncTierProfileRegistry tierProfileRegistry,
      SyncProperties properties
  ) {
    this.syncTransportClient = syncTransportClient;
    this.syncStateStore = syncStateStore;
    this.downstreamFeedStore = downstreamFeedStore;
    this.fanoutPlanner = fanoutPlanner;
    this.tierProfileRegistry = tierProfileRegistry;
    this.properties = properties;
  }

  public int forwardFromCentral() {
    SyncTierProfile profile = tierProfileRegistry.currentProfile();
    if (!profile.downstreamEnabled()) {
      return 0;
    }
    String nodeId = requireNodeId();
    long storeId = requireStoreId();
    String cursor = syncStateStore.readOffset(nodeId, FORWARDING_STREAM);
    long logId = syncStateStore.openSyncLog(
        nodeId,
        storeId,
        SyncDirection.CENTRAL_TO_REGION,
        SyncStatus.PENDING,
        "Forwarding central events to regional downstream feed");
    try {
      SyncDtos.SyncDownloadResponse response = syncTransportClient.download(storeId, cursor, properties.getBatchSize());
      if (response == null || response.events() == null || response.events().isEmpty()) {
        syncStateStore.finishSyncLog(logId, SyncStatus.SENT, 0, "No central events to forward");
        return 0;
      }

      List<SyncDtos.SyncAckItem> ackItems = new ArrayList<>();
      int forwardedCount = 0;
      for (SyncDtos.SyncDownloadEvent event : response.events()) {
        if (!profile.pullDownAggregates().contains(event.aggregateType())) {
          ackItems.add(new SyncDtos.SyncAckItem(
              event.eventId(),
              SyncStatus.REJECTED,
              "Aggregate not enabled for tier " + profile.tier()));
          continue;
        }
        List<DownstreamFanoutPlanner.RecipientPlan> recipients = fanoutPlanner.planRecipients(event);
        if (recipients.isEmpty()) {
          ackItems.add(new SyncDtos.SyncAckItem(
              event.eventId(),
              SyncStatus.REJECTED,
              "No managed child recipients matched"));
          continue;
        }
        for (DownstreamFanoutPlanner.RecipientPlan recipient : recipients) {
          downstreamFeedStore.appendDownstreamEvent(
              recipient.sourceNodeId(),
              recipient.eventType(),
              recipient.aggregateType(),
              recipient.aggregateId(),
              recipient.targetScope(),
              recipient.targetStoreId(),
              recipient.targetStoreGroupId(),
              recipient.targetNodeId(),
              recipient.payload(),
              recipient.version()
          );
          forwardedCount++;
        }
        ackItems.add(new SyncDtos.SyncAckItem(event.eventId(), SyncStatus.APPLIED, null));
      }

      syncTransportClient.ack(new SyncDtos.SyncAckRequest(nodeId, storeId, ackItems));
      syncStateStore.saveOffset(nodeId, FORWARDING_STREAM, response.nextCursor());
      syncStateStore.finishSyncLog(
          logId,
          SyncStatus.SENT,
          response.events().size(),
          "Forwarded " + forwardedCount + " downstream events from central feed");
      return forwardedCount;
    } catch (Exception e) {
      syncStateStore.finishSyncLog(logId, SyncStatus.FAILED, 0, e.getMessage());
      throw e;
    }
  }

  private String requireNodeId() {
    if (properties.getNodeId() == null || properties.getNodeId().isBlank()) {
      throw new IllegalStateException("sync.node-id is required for regional forwarding");
    }
    return properties.getNodeId();
  }

  private long requireStoreId() {
    if (properties.getStoreId() == null || properties.getStoreId().isBlank()) {
      throw new IllegalStateException("sync.store-id is required for regional forwarding");
    }
    return Long.parseLong(properties.getStoreId());
  }
}
