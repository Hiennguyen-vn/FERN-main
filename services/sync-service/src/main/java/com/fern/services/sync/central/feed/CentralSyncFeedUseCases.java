package com.fern.services.sync.central.feed;

import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.application.SyncDownloadService;
import com.fern.services.sync.application.SyncStatusService;
import org.springframework.stereotype.Service;

@Service
public class CentralSyncFeedUseCases {

  private final SyncDownloadService downloadService;
  private final SyncStatusService statusService;

  public CentralSyncFeedUseCases(SyncDownloadService downloadService, SyncStatusService statusService) {
    this.downloadService = downloadService;
    this.statusService = statusService;
  }

  public SyncDtos.SyncDownloadResponse download(long storeId, String cursor, Integer limit) {
    return downloadService.download(storeId, cursor, limit);
  }

  public SyncDtos.SyncStatusResponse status(long storeId) {
    return statusService.status(storeId);
  }
}
