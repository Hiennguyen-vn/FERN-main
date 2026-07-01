package com.fern.services.sync.hub;

import com.fasterxml.jackson.databind.JsonNode;
import com.fern.common.middleware.ServiceException;
import com.fern.common.spring.auth.RequestUserContext;
import com.fern.common.spring.auth.RequestUserContextHolder;
import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.application.SyncProperties;
import com.fern.services.sync.state.NodeTopologyStore;
import com.fern.services.sync.state.NodeTopologyStore.NodeTopology;
import org.springframework.stereotype.Component;

@Component
public class RegionalHubNodeScopePolicy {

  private final NodeTopologyStore nodeTopologyStore;
  private final SyncProperties syncProperties;

  public RegionalHubNodeScopePolicy(NodeTopologyStore nodeTopologyStore, SyncProperties syncProperties) {
    this.nodeTopologyStore = nodeTopologyStore;
    this.syncProperties = syncProperties;
  }

  public NodeTopology requireManagedChild(String nodeId, long storeId) {
    RequestUserContext context = RequestUserContextHolder.get();
    if (context.isDeviceContext() && context.deviceOutletId() != storeId) {
      throw ServiceException.forbidden("Node credential cannot access another store");
    }
    if (!context.internalService() && !context.isDeviceContext()
        && !context.outletIds().isEmpty() && !context.outletIds().contains(storeId)
        && !context.hasRole("superadmin")) {
      throw ServiceException.forbidden("Store sync scope denied");
    }

    NodeTopology topology = nodeTopologyStore.findNodeTopology(nodeId)
        .orElseThrow(() -> ServiceException.forbidden("Sync node is not active for store " + storeId));
    if (!"ACTIVE".equalsIgnoreCase(topology.status())) {
      throw ServiceException.forbidden("Sync node is not active for store " + storeId);
    }
    if (topology.storeId() != storeId) {
      throw ServiceException.forbidden("Sync node store scope does not match request storeId");
    }
    String currentHubNodeId = syncProperties.getNodeId();
    if (currentHubNodeId == null || currentHubNodeId.isBlank()) {
      throw ServiceException.forbidden("Regional hub nodeId is not configured");
    }
    if (!currentHubNodeId.equals(topology.parentNodeId())) {
      throw ServiceException.forbidden("Sync node is outside this regional hub scope");
    }
    return topology;
  }

  public void requireUploadScope(SyncDtos.SyncUploadRequest request) {
    requireManagedChild(request.nodeId(), request.storeId());
    for (SyncDtos.SyncEvent event : request.events()) {
      Long payloadStoreId = payloadStoreId(event.payload());
      if (payloadStoreId != null && payloadStoreId.longValue() != request.storeId()) {
        throw ServiceException.forbidden("Event payload store scope does not match request storeId");
      }
    }
  }

  public void requireDownloadScope(String nodeId, long storeId) {
    requireManagedChild(nodeId, storeId);
  }

  public void requireAckScope(SyncDtos.SyncAckRequest request) {
    requireManagedChild(request.nodeId(), request.storeId());
  }

  public NodeTopology requireManagedChildByStore(long storeId) {
    RequestUserContext context = RequestUserContextHolder.get();
    if (context.isDeviceContext() && context.deviceOutletId() != storeId) {
      throw ServiceException.forbidden("Store node cannot download another store scope");
    }
    if (!context.internalService() && !context.isDeviceContext()
        && !context.outletIds().isEmpty() && !context.outletIds().contains(storeId)
        && !context.hasRole("superadmin")) {
      throw ServiceException.forbidden("Store sync scope denied");
    }
    String currentHubNodeId = syncProperties.getNodeId();
    if (currentHubNodeId == null || currentHubNodeId.isBlank()) {
      throw ServiceException.forbidden("Regional hub nodeId is not configured");
    }
    return nodeTopologyStore.findManagedChild(currentHubNodeId, storeId)
        .filter(topology -> "ACTIVE".equalsIgnoreCase(topology.status()))
        .orElseThrow(() -> ServiceException.forbidden("Sync node is not active for store " + storeId));
  }

  private Long payloadStoreId(JsonNode payload) {
    if (payload == null || payload.isNull()) {
      return null;
    }
    JsonNode camel = payload.get("storeId");
    if (camel != null && camel.canConvertToLong()) {
      return camel.longValue();
    }
    JsonNode snake = payload.get("store_id");
    if (snake != null && snake.canConvertToLong()) {
      return snake.longValue();
    }
    JsonNode outlet = payload.get("outlet_id");
    if (outlet != null && outlet.canConvertToLong()) {
      return outlet.longValue();
    }
    JsonNode outletCamel = payload.get("outletId");
    if (outletCamel != null && outletCamel.canConvertToLong()) {
      return outletCamel.longValue();
    }
    return null;
  }
}
