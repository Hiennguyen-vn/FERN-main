package com.fern.services.sync.edge;

import org.springframework.stereotype.Service;

@Service
public class EdgeSyncFacade {

  private final TieredSyncFacade tieredSyncFacade;

  public EdgeSyncFacade(TieredSyncFacade tieredSyncFacade) {
    this.tieredSyncFacade = tieredSyncFacade;
  }

  public int uploadPendingEvents() {
    return tieredSyncFacade.syncUp();
  }

  public int downloadAndApplyEvents() {
    return tieredSyncFacade.syncDown();
  }
}
