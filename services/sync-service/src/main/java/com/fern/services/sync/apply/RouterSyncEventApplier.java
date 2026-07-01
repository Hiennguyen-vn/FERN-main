package com.fern.services.sync.apply;

import com.fern.services.sync.api.SyncDtos;
import org.springframework.stereotype.Component;

@Component
public class RouterSyncEventApplier implements SyncEventApplier {

  private final SyncPayloadRouter syncPayloadRouter;

  public RouterSyncEventApplier(SyncPayloadRouter syncPayloadRouter) {
    this.syncPayloadRouter = syncPayloadRouter;
  }

  @Override
  public boolean apply(SyncDtos.SyncEvent event) {
    return syncPayloadRouter.apply(event);
  }
}
