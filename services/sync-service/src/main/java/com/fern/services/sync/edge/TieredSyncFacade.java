package com.fern.services.sync.edge;

import com.fern.services.sync.orchestration.TieredSyncOrchestrator;
import org.springframework.stereotype.Service;

@Service
public class TieredSyncFacade {

  private final TieredSyncOrchestrator orchestrator;

  public TieredSyncFacade(TieredSyncOrchestrator orchestrator) {
    this.orchestrator = orchestrator;
  }

  public int syncUp() {
    return orchestrator.syncUp();
  }

  public int syncDown() {
    return orchestrator.syncDown();
  }
}
