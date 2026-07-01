package com.fern.services.sync.state;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Component;

@Component
public class DatabaseDownstreamStateStore
    implements DownstreamFeedStore, DownstreamInboxStore, NodeTopologyStore {

  private final SyncRepository syncRepository;

  public DatabaseDownstreamStateStore(SyncRepository syncRepository) {
    this.syncRepository = syncRepository;
  }

  @Override
  public long appendDownstreamEvent(
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
  ) {
    return syncRepository.appendDownstreamEvent(
        sourceNodeId,
        eventType,
        aggregateType,
        aggregateId,
        targetScope,
        targetStoreId,
        targetStoreGroupId,
        targetNodeId,
        payload,
        version);
  }

  @Override
  public List<DownstreamEvent> readDownstreamEvents(String targetNodeId, Long targetStoreId, long cursor, int limit) {
    return syncRepository.readDownstreamEvents(targetNodeId, targetStoreId, cursor, limit);
  }

  @Override
  public void recordDownstreamAck(String eventId, String nodeId, Long storeId, String status, String errorMessage) {
    syncRepository.recordDownstreamAck(eventId, nodeId, storeId, status, errorMessage);
  }

  @Override
  public IngestResult insertDownstreamInbox(String nodeId, Long storeId, com.fern.services.sync.api.SyncDtos.SyncEvent event) {
    return syncRepository.insertDownstreamInbox(nodeId, storeId, event);
  }

  @Override
  public Optional<NodeTopology> findNodeTopology(String nodeId) {
    return syncRepository.findNodeTopology(nodeId);
  }

  @Override
  public Optional<NodeTopology> findManagedChild(String parentNodeId, long storeId) {
    return syncRepository.findManagedChild(parentNodeId, storeId);
  }

  @Override
  public List<NodeTopology> listManagedChildren(String parentNodeId) {
    return syncRepository.listManagedChildren(parentNodeId);
  }

  @Override
  public List<NodeTopology> listManagedChildrenByStoreIds(String parentNodeId, List<Long> storeIds) {
    return syncRepository.listManagedChildrenByStoreIds(parentNodeId, storeIds);
  }
}
