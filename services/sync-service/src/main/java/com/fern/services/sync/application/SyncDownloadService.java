package com.fern.services.sync.application;

import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.state.SyncRepository;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class SyncDownloadService {

  private final SyncRepository syncRepository;
  private final SyncNodeAuthService syncNodeAuthService;
  private final SyncProperties syncProperties;

  public SyncDownloadService(
      SyncRepository syncRepository,
      SyncNodeAuthService syncNodeAuthService,
      SyncProperties syncProperties
  ) {
    this.syncRepository = syncRepository;
    this.syncNodeAuthService = syncNodeAuthService;
    this.syncProperties = syncProperties;
  }

  public SyncDtos.SyncDownloadResponse download(long storeId, String cursor, Integer limit) {
    syncNodeAuthService.requireDownloadScope(storeId);
    int batchSize = sanitizeLimit(limit);
    long offset = parseCursor(cursor);
    List<SyncRepository.CentralOutboxRow> rows = syncRepository.findDownloadEvents(storeId, offset, batchSize + 1);
    boolean hasMore = rows.size() > batchSize;
    List<SyncDtos.SyncDownloadEvent> events = rows.stream()
        .limit(batchSize)
        .map(row -> new SyncDtos.SyncDownloadEvent(
            Long.toString(row.id()),
            row.eventType(),
            row.aggregateType(),
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
    return new SyncDtos.SyncDownloadResponse(events, nextCursor, hasMore);
  }

  private int sanitizeLimit(Integer limit) {
    int defaultLimit = Math.max(1, syncProperties.getBatchSize());
    if (limit == null) {
      return defaultLimit;
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
