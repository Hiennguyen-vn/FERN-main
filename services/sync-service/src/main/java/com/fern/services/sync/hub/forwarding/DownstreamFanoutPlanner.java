package com.fern.services.sync.hub.forwarding;

import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.application.SyncProperties;
import com.fern.services.sync.model.TargetScope;
import com.fern.services.sync.state.NodeTopologyStore;
import com.fern.services.sync.state.NodeTopologyStore.NodeTopology;
import java.util.List;
import org.springframework.stereotype.Component;

@Component
public class DownstreamFanoutPlanner {

  private final NodeTopologyStore nodeTopologyStore;
  private final SyncProperties syncProperties;

  public DownstreamFanoutPlanner(NodeTopologyStore nodeTopologyStore, SyncProperties syncProperties) {
    this.nodeTopologyStore = nodeTopologyStore;
    this.syncProperties = syncProperties;
  }

  public List<RecipientPlan> planRecipients(SyncDtos.SyncDownloadEvent event) {
    String hubNodeId = requireHubNodeId();
    if (event.targetStoreGroupId() != null && event.targetStoreId() == null) {
      throw new IllegalStateException("Store-group fanout is not implemented for REGIONAL_HUB");
    }
    if (event.targetStoreId() != null) {
      return nodeTopologyStore.listManagedChildrenByStoreIds(hubNodeId, List.of(event.targetStoreId())).stream()
          .map(child -> toRecipient(event, child, TargetScope.NODE))
          .toList();
    }
    return nodeTopologyStore.listManagedChildren(hubNodeId).stream()
        .map(child -> toRecipient(event, child, TargetScope.NODE))
        .toList();
  }

  private RecipientPlan toRecipient(SyncDtos.SyncDownloadEvent event, NodeTopology child, TargetScope targetScope) {
    return new RecipientPlan(
        child.nodeId(),
        child.storeId(),
        event.eventType().name(),
        event.aggregateType().name(),
        event.aggregateId(),
        targetScope.name(),
        child.storeId(),
        event.targetStoreGroupId(),
        child.nodeId(),
        event.payload(),
        event.version()
    );
  }

  private String requireHubNodeId() {
    if (syncProperties.getNodeId() == null || syncProperties.getNodeId().isBlank()) {
      throw new IllegalStateException("sync.node-id is required for REGIONAL_HUB forwarding");
    }
    return syncProperties.getNodeId();
  }

  public record RecipientPlan(
      String sourceNodeId,
      long recipientStoreId,
      String eventType,
      String aggregateType,
      String aggregateId,
      String targetScope,
      Long targetStoreId,
      Long targetStoreGroupId,
      String targetNodeId,
      com.fasterxml.jackson.databind.JsonNode payload,
      long version
  ) {
  }
}
