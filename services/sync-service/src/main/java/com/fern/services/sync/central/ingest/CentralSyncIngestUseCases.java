package com.fern.services.sync.central.ingest;

import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.application.SyncInboxService;
import com.fern.services.sync.application.SyncUploadService;
import org.springframework.stereotype.Service;

@Service
public class CentralSyncIngestUseCases {

  private final SyncUploadService uploadService;
  private final SyncInboxService inboxService;

  public CentralSyncIngestUseCases(SyncUploadService uploadService, SyncInboxService inboxService) {
    this.uploadService = uploadService;
    this.inboxService = inboxService;
  }

  public SyncDtos.SyncUploadResponse upload(SyncDtos.SyncUploadRequest request) {
    return uploadService.upload(request);
  }

  public void ack(SyncDtos.SyncAckRequest request) {
    inboxService.ack(request);
  }
}
