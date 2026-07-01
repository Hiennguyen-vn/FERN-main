package com.fern.services.sync.apply;

import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.model.AggregateType;
import com.fern.services.sync.model.EventType;

public interface SyncPayloadHandler {

  boolean supports(EventType eventType, AggregateType aggregateType);

  void apply(SyncDtos.SyncEvent event);
}
