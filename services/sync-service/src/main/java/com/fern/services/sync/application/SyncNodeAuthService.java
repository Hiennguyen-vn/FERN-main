package com.fern.services.sync.application;

import com.fasterxml.jackson.databind.JsonNode;
import com.fern.common.middleware.ServiceException;
import com.fern.common.spring.auth.RequestUserContext;
import com.fern.common.spring.auth.RequestUserContextHolder;
import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.infrastructure.SyncRepository;
import org.springframework.stereotype.Service;

@Service
public class SyncNodeAuthService {

  private final SyncRepository syncRepository;

  public SyncNodeAuthService(SyncRepository syncRepository) {
    this.syncRepository = syncRepository;
  }

  public void requireUploadScope(SyncDtos.SyncUploadRequest request) {
    requireStoreScope(request.nodeId(), request.storeId());
    for (SyncDtos.SyncEvent event : request.events()) {
      Long payloadStoreId = payloadStoreId(event.payload());
      if (payloadStoreId != null && payloadStoreId.longValue() != request.storeId()) {
        throw ServiceException.forbidden("Event payload store scope does not match request storeId");
      }
    }
  }

  public void requireDownloadScope(long storeId) {
    RequestUserContext context = RequestUserContextHolder.get();
    if (context.isDeviceContext() && context.deviceOutletId() != storeId) {
      throw ServiceException.forbidden("Store node cannot download another store scope");
    }
    if (!context.internalService() && !context.isDeviceContext()
        && !context.outletIds().isEmpty() && !context.outletIds().contains(storeId)
        && !context.hasRole("superadmin")) {
      throw ServiceException.forbidden("Store sync scope denied");
    }
  }

  public void requireStoreScope(String nodeId, long storeId) {
    RequestUserContext context = RequestUserContextHolder.get();
    if (context.isDeviceContext() && context.deviceOutletId() != storeId) {
      throw ServiceException.forbidden("Node credential cannot access another store");
    }
    if (!context.internalService() && !context.isDeviceContext()
        && !context.outletIds().isEmpty() && !context.outletIds().contains(storeId)
        && !context.hasRole("superadmin")) {
      throw ServiceException.forbidden("Store sync scope denied");
    }
    syncRepository.findActiveNode(nodeId, storeId)
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
