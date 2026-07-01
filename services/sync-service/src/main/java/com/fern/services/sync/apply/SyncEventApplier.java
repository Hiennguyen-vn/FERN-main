package com.fern.services.sync.apply;

import com.fern.services.sync.api.SyncDtos;

public interface SyncEventApplier {

  boolean apply(SyncDtos.SyncEvent event);
}
