package com.fern.services.sync.hub.status;

import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.hub.RegionalHubNodeScopePolicy;
import com.fern.services.sync.state.SyncRepository;
import org.springframework.stereotype.Service;

@Service
public class RegionalHubStatusUseCases {

  private final SyncRepository syncRepository;
  private final RegionalHubNodeScopePolicy nodeScopePolicy;

  public RegionalHubStatusUseCases(SyncRepository syncRepository, RegionalHubNodeScopePolicy nodeScopePolicy) {
    this.syncRepository = syncRepository;
    this.nodeScopePolicy = nodeScopePolicy;
  }

  public SyncDtos.SyncStatusResponse status(String nodeId, long storeId) {
    nodeScopePolicy.requireDownloadScope(nodeId, storeId);
    return syncRepository.hubStatus(storeId);
  }

  public SyncDtos.SyncStatusResponse statusForManagedStore(long storeId) {
    String childNodeId = nodeScopePolicy.requireManagedChildByStore(storeId).nodeId();
    return status(childNodeId, storeId);
  }
}
