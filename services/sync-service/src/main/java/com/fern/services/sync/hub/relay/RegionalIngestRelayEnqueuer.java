package com.fern.services.sync.hub.relay;

import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.state.RegionalRelayStateStore;
import org.springframework.stereotype.Component;

@Component
public class RegionalIngestRelayEnqueuer {

  private final RegionalRelayStateStore regionalRelayStateStore;

  public RegionalIngestRelayEnqueuer(RegionalRelayStateStore regionalRelayStateStore) {
    this.regionalRelayStateStore = regionalRelayStateStore;
  }

  public void enqueueAccepted(String nodeId, long storeId, SyncDtos.SyncEvent event) {
    regionalRelayStateStore.enqueueAcceptedRelayCandidate(nodeId, storeId, event);
  }
}
