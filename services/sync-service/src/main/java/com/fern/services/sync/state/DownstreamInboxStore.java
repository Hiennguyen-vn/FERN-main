package com.fern.services.sync.state;

import com.fern.services.sync.api.SyncDtos;

public interface DownstreamInboxStore {

  IngestResult insertDownstreamInbox(String nodeId, Long storeId, SyncDtos.SyncEvent event);

  enum IngestResult {
    ACCEPTED,
    DUPLICATED
  }
}
