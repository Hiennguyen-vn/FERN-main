package com.fern.services.sync.application;

import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.state.SyncRepository;
import com.fern.services.sync.model.TargetScope;
import org.springframework.stereotype.Service;

@Service
public class SyncOutboxService {

  private final SyncRepository syncRepository;

  public SyncOutboxService(SyncRepository syncRepository) {
    this.syncRepository = syncRepository;
  }

  public long publishCentralEvent(SyncDtos.CentralOutboxPublishRequest request) {
    TargetScope targetScope = request.targetStoreId() == null
        ? TargetScope.ALL_STORES
        : TargetScope.STORE;
    long version = request.version() == null ? nextVersionFor(request) : request.version();
    return syncRepository.appendCentralOutbox(
        request.eventType(),
        request.aggregateType(),
        request.aggregateId(),
        request.payload(),
        targetScope,
        request.targetStoreId(),
        request.targetStoreGroupId(),
        version
    );
  }

  private long nextVersionFor(SyncDtos.CentralOutboxPublishRequest request) {
    return Math.abs((request.aggregateType().name() + ":" + request.aggregateId()).hashCode())
        + System.currentTimeMillis();
  }
}
