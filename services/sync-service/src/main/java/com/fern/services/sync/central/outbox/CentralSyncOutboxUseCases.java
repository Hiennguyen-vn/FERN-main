package com.fern.services.sync.central.outbox;

import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.application.SyncOutboxService;
import org.springframework.stereotype.Service;

@Service
public class CentralSyncOutboxUseCases {

  private final SyncOutboxService outboxService;

  public CentralSyncOutboxUseCases(SyncOutboxService outboxService) {
    this.outboxService = outboxService;
  }

  public long publishCentralEvent(SyncDtos.CentralOutboxPublishRequest request) {
    return outboxService.publishCentralEvent(request);
  }
}
