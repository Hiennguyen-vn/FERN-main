package com.fern.services.sync.apply;

import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.state.SyncRepository;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class SyncPayloadRouter {

  private final List<SyncPayloadHandler> handlers;
  private final SyncConflictPolicy syncConflictPolicy;
  private final SyncRepository syncRepository;

  public SyncPayloadRouter(
      List<SyncPayloadHandler> handlers,
      SyncConflictPolicy syncConflictPolicy,
      SyncRepository syncRepository
  ) {
    this.handlers = handlers;
    this.syncConflictPolicy = syncConflictPolicy;
    this.syncRepository = syncRepository;
  }

  public boolean apply(SyncDtos.SyncEvent event) {
    if (!syncConflictPolicy.shouldApply(event)) {
      return false;
    }
    SyncPayloadHandler handler = handlers.stream()
        .filter(candidate -> candidate.supports(event.eventType(), event.aggregateType()))
        .findFirst()
        .orElse(null);
    if (handler == null) {
      syncRepository.recordConflict(event, "NO_HANDLER", "No sync payload handler registered");
      return false;
    }
    try {
      handler.apply(event);
      syncConflictPolicy.markApplied(event);
      return true;
    } catch (Exception e) {
      syncRepository.recordConflict(event, "APPLY_FAILED", e.getMessage());
      return false;
    }
  }
}
