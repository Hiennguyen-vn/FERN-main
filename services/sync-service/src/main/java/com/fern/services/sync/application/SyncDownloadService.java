package com.fern.services.sync.application;

import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.infrastructure.SyncRepository;
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
    List<SyncDtos.SyncEvent> events = rows.stream()
        .limit(batchSize)
        .map(row -> new SyncDtos.SyncEvent(
            Long.toString(row.id()),
            row.eventType(),
            row.aggregateType(),
            row.aggregateId(),
            row.version(),
            row.createdAt(),
            row.payload()
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
      return 0L;
    }
  }
}
