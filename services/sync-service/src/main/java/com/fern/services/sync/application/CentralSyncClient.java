package com.fern.services.sync.application;

import com.fern.services.sync.api.SyncDtos;

public interface CentralSyncClient {

  SyncDtos.SyncUploadResponse upload(SyncDtos.SyncUploadRequest request);
}
