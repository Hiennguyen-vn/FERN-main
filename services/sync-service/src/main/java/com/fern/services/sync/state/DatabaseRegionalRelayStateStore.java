package com.fern.services.sync.state;

import com.fern.services.sync.api.SyncDtos;
import java.util.List;
import org.springframework.stereotype.Component;

@Component
public class DatabaseRegionalRelayStateStore implements RegionalRelayStateStore {

  private final SyncRepository syncRepository;

  public DatabaseRegionalRelayStateStore(SyncRepository syncRepository) {
    this.syncRepository = syncRepository;
  }

  @Override
  public void enqueueAcceptedRelayCandidate(String nodeId, long storeId, SyncDtos.SyncEvent event) {
    syncRepository.enqueueAcceptedRelayCandidate(nodeId, storeId, event);
  }

  @Override
  public List<PendingRelayEvent> claimPendingRelayEvents(int limit) {
    return syncRepository.claimPendingRelayEvents(limit);
  }

  @Override
  public void markRelaySent(List<String> relayIds) {
    syncRepository.markRelaySent(relayIds);
  }

  @Override
  public void markRelayFailed(List<String> relayIds, String errorMessage) {
    syncRepository.markRelayFailed(relayIds, errorMessage);
  }
}
