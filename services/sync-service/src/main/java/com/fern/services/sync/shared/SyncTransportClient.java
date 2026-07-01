package com.fern.services.sync.shared;

import com.fern.services.sync.api.SyncDtos;

public interface SyncTransportClient {

  SyncDtos.SyncUploadResponse upload(SyncDtos.SyncUploadRequest request);

  SyncDtos.SyncDownloadResponse download(long storeId, String cursor, Integer limit);

  void ack(SyncDtos.SyncAckRequest request);
}
