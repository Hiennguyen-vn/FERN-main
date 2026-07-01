package com.fern.services.sync.hub;

import com.fern.common.middleware.ServiceException;
import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.application.SyncNodeProvisioningService;
import com.fern.services.sync.model.TargetScope;
import com.fern.services.sync.state.DownstreamFeedStore;
import com.fern.services.sync.state.NodeTopologyStore;
import com.fern.services.sync.state.SyncRepository;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class RegionalHubNodeLifecycleUseCases {

  private final SyncNodeProvisioningService nodeProvisioningService;
  private final DownstreamFeedStore downstreamFeedStore;
  private final NodeTopologyStore nodeTopologyStore;
  private final SyncRepository syncRepository;
  private final com.fern.services.sync.application.SyncProperties properties;

  public RegionalHubNodeLifecycleUseCases(
      SyncNodeProvisioningService nodeProvisioningService,
      DownstreamFeedStore downstreamFeedStore,
      NodeTopologyStore nodeTopologyStore,
      SyncRepository syncRepository,
      com.fern.services.sync.application.SyncProperties properties
  ) {
    this.nodeProvisioningService = nodeProvisioningService;
    this.downstreamFeedStore = downstreamFeedStore;
    this.nodeTopologyStore = nodeTopologyStore;
    this.syncRepository = syncRepository;
    this.properties = properties;
  }

  public long publishForManagedChildren(SyncDtos.CentralOutboxPublishRequest request) {
    if (request.targetStoreId() == null) {
      List<NodeTopologyStore.NodeTopology> children = nodeTopologyStore.listManagedChildren(requireHubNodeId());
      long lastId = 0;
      for (NodeTopologyStore.NodeTopology child : children) {
        lastId = downstreamFeedStore.appendDownstreamEvent(
            requireHubNodeId(),
            request.eventType().name(),
            request.aggregateType().name(),
            request.aggregateId(),
            TargetScope.NODE.name(),
            child.storeId(),
            request.targetStoreGroupId(),
            child.nodeId(),
            request.payload(),
            resolveVersion(request)
        );
      }
      return lastId;
    }

    NodeTopologyStore.NodeTopology child = requireManagedChildByStore(request.targetStoreId());
    return downstreamFeedStore.appendDownstreamEvent(
        requireHubNodeId(),
        request.eventType().name(),
        request.aggregateType().name(),
        request.aggregateId(),
        TargetScope.NODE.name(),
        child.storeId(),
        request.targetStoreGroupId(),
        child.nodeId(),
        request.payload(),
        resolveVersion(request)
    );
  }

  public SyncDtos.ProvisionSyncNodeResponse provisionManagedNode(SyncDtos.ProvisionSyncNodeRequest request) {
    validateManagedProvisioningRequest(request);
    SyncDtos.ProvisionSyncNodeResponse provisioned = nodeProvisioningService.provision(request);
    syncRepository.assignNodeToParent(provisioned.nodeId(), requireHubNodeId(), "OUTLET_EDGE");
    return provisioned;
  }

  public SyncDtos.RotateSyncNodeSecretResponse rotateManagedNodeSecret(String nodeId) {
    requireManagedChild(nodeId);
    return nodeProvisioningService.rotateSecret(nodeId);
  }

  public void revokeManagedNode(String nodeId) {
    requireManagedChild(nodeId);
    nodeProvisioningService.revoke(nodeId);
  }

  public SyncDtos.SyncHandshakeResponse handshakeManagedNode(SyncDtos.SyncHandshakeRequest request) {
    requireManagedChild(request.nodeId());
    return nodeProvisioningService.handshake(request);
  }

  private NodeTopologyStore.NodeTopology requireManagedChild(String nodeId) {
    return nodeTopologyStore.findNodeTopology(nodeId)
        .filter(topology -> requireHubNodeId().equals(topology.parentNodeId()))
        .orElseThrow(() -> ServiceException.forbidden("Sync node is outside this regional hub scope"));
  }

  private NodeTopologyStore.NodeTopology requireManagedChildByStore(long storeId) {
    return nodeTopologyStore.findManagedChild(requireHubNodeId(), storeId)
        .orElseThrow(() -> ServiceException.forbidden("Managed child node not found for store " + storeId));
  }

  private String requireHubNodeId() {
    if (properties.getNodeId() == null || properties.getNodeId().isBlank()) {
      throw ServiceException.forbidden("Regional hub nodeId is not configured");
    }
    return properties.getNodeId();
  }

  private long resolveVersion(SyncDtos.CentralOutboxPublishRequest request) {
    if (request.version() != null) {
      return request.version();
    }
    return Math.abs((request.aggregateType().name() + ":" + request.aggregateId()).hashCode())
        + System.currentTimeMillis();
  }

  private void validateManagedProvisioningRequest(SyncDtos.ProvisionSyncNodeRequest request) {
    if (request.storeId() == null || request.storeId() <= 0) {
      throw ServiceException.forbidden("Managed child provisioning requires a valid storeId");
    }
    String requestedType = request.nodeType() == null ? "STORE_EDGE" : request.nodeType().trim().toUpperCase();
    if (!"STORE_EDGE".equals(requestedType)) {
      throw ServiceException.forbidden("Regional hub may only provision STORE_EDGE managed children");
    }
  }
}
