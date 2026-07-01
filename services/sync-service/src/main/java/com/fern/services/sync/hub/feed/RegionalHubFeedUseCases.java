package com.fern.services.sync.hub.feed;

import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.hub.RegionalHubNodeScopePolicy;
import com.fern.services.sync.state.DownstreamFeedStore;
import com.fern.services.sync.state.SyncStateStore;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class RegionalHubFeedUseCases {

  static final String DOWNSTREAM_STREAM = "downstream-outbox";

  private final DownstreamFeedStore downstreamFeedStore;
  private final SyncStateStore syncStateStore;
  private final RegionalHubNodeScopePolicy nodeScopePolicy;

  public RegionalHubFeedUseCases(
      DownstreamFeedStore downstreamFeedStore,
      SyncStateStore syncStateStore,
      RegionalHubNodeScopePolicy nodeScopePolicy
  ) {
    this.downstreamFeedStore = downstreamFeedStore;
    this.syncStateStore = syncStateStore;
    this.nodeScopePolicy = nodeScopePolicy;
  }

  public SyncDtos.SyncDownloadResponse download(String nodeId, long storeId, String cursor, Integer limit) {
    nodeScopePolicy.requireDownloadScope(nodeId, storeId);
    int batchSize = sanitizeLimit(limit);
    long offset = parseCursor(cursor);
    List<DownstreamFeedStore.DownstreamEvent> rows =
        downstreamFeedStore.readDownstreamEvents(nodeId, storeId, offset, batchSize + 1);
    boolean hasMore = rows.size() > batchSize;
    List<SyncDtos.SyncDownloadEvent> events = rows.stream()
        .limit(batchSize)
        .map(row -> new SyncDtos.SyncDownloadEvent(
            Long.toString(row.id()),
            com.fern.services.sync.model.EventType.valueOf(row.eventType()),
            com.fern.services.sync.model.AggregateType.valueOf(row.aggregateType()),
            row.aggregateId(),
            row.version(),
            row.createdAt(),
            row.payload(),
            row.targetScope(),
            row.targetStoreId(),
            row.targetStoreGroupId()
        ))
        .toList();
    String nextCursor = events.isEmpty() ? Long.toString(offset) : events.getLast().eventId();
    syncStateStore.saveOffset(nodeId, DOWNSTREAM_STREAM, nextCursor);
    return new SyncDtos.SyncDownloadResponse(events, nextCursor, hasMore);
  }

  public void ack(SyncDtos.SyncAckRequest request) {
    nodeScopePolicy.requireAckScope(request);
    for (SyncDtos.SyncAckItem event : request.events()) {
      downstreamFeedStore.recordDownstreamAck(
          event.eventId(),
          request.nodeId(),
          request.storeId(),
          event.status().name(),
          event.errorMessage());
    }
  }

  public SyncDtos.SyncDownloadResponse downloadForManagedStore(long storeId, String cursor, Integer limit) {
    String childNodeId = nodeScopePolicy.requireManagedChildByStore(storeId).nodeId();
    return download(childNodeId, storeId, cursor, limit);
  }

  private int sanitizeLimit(Integer limit) {
    if (limit == null) {
      return 100;
    }
    return Math.max(1, Math.min(limit, 500));
  }

  private long parseCursor(String cursor) {
    if (cursor == null || cursor.isBlank()) {
      return 0L;
    }
    try {
      return Long.parseLong(cursor.trim());
    } catch (NumberFormatException e) {
      throw com.fern.common.middleware.ServiceException.badRequest("Invalid sync cursor");
    }
  }
}
