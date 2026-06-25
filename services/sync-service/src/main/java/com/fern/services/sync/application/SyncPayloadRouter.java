package com.fern.services.sync.application;

import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.infrastructure.SyncRepository;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class SyncPayloadRouter {

  private final List<SyncPayloadHandler> handlers;
  private final SyncApplyService syncApplyService;
  private final SyncRepository syncRepository;

  public SyncPayloadRouter(
      List<SyncPayloadHandler> handlers,
      SyncApplyService syncApplyService,
      SyncRepository syncRepository
  ) {
    this.handlers = handlers;
    this.syncApplyService = syncApplyService;
    this.syncRepository = syncRepository;
  }

  public boolean apply(SyncDtos.SyncEvent event) {
    if (!syncApplyService.shouldApply(event)) {
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
      syncApplyService.markApplied(event);
      return true;
    } catch (Exception e) {
      syncRepository.recordConflict(event, "APPLY_FAILED", e.getMessage());
      return false;
    }
  }
}
