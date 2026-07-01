package com.fern.services.sync.central.node;

import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.application.SyncNodeProvisioningService;
import org.springframework.stereotype.Service;

@Service
public class CentralSyncNodeLifecycleUseCases {

  private final SyncNodeProvisioningService nodeProvisioningService;

  public CentralSyncNodeLifecycleUseCases(SyncNodeProvisioningService nodeProvisioningService) {
    this.nodeProvisioningService = nodeProvisioningService;
  }

  public SyncDtos.ProvisionSyncNodeResponse provisionNode(SyncDtos.ProvisionSyncNodeRequest request) {
    return nodeProvisioningService.provision(request);
  }

  public SyncDtos.RotateSyncNodeSecretResponse rotateNodeSecret(String nodeId) {
    return nodeProvisioningService.rotateSecret(nodeId);
  }

  public void revokeNode(String nodeId) {
    nodeProvisioningService.revoke(nodeId);
  }

  public SyncDtos.SyncHandshakeResponse handshake(SyncDtos.SyncHandshakeRequest request) {
    return nodeProvisioningService.handshake(request);
  }
}
