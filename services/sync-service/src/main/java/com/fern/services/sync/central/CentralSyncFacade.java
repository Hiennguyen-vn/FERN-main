package com.fern.services.sync.central;

import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.central.feed.CentralSyncFeedUseCases;
import com.fern.services.sync.central.ingest.CentralSyncIngestUseCases;
import com.fern.services.sync.central.node.CentralSyncNodeLifecycleUseCases;
import com.fern.services.sync.central.outbox.CentralSyncOutboxUseCases;
import org.springframework.stereotype.Service;

@Service
public class CentralSyncFacade {

  private final CentralSyncIngestUseCases ingestUseCases;
  private final CentralSyncFeedUseCases feedUseCases;
  private final CentralSyncOutboxUseCases outboxUseCases;
  private final CentralSyncNodeLifecycleUseCases nodeLifecycleUseCases;

  public CentralSyncFacade(
      CentralSyncIngestUseCases ingestUseCases,
      CentralSyncFeedUseCases feedUseCases,
      CentralSyncOutboxUseCases outboxUseCases,
      CentralSyncNodeLifecycleUseCases nodeLifecycleUseCases
  ) {
    this.ingestUseCases = ingestUseCases;
    this.feedUseCases = feedUseCases;
    this.outboxUseCases = outboxUseCases;
    this.nodeLifecycleUseCases = nodeLifecycleUseCases;
  }

  public SyncDtos.SyncUploadResponse upload(SyncDtos.SyncUploadRequest request) {
    return ingestUseCases.upload(request);
  }

  public SyncDtos.SyncDownloadResponse download(long storeId, String cursor, Integer limit) {
    return feedUseCases.download(storeId, cursor, limit);
  }

  public void ack(SyncDtos.SyncAckRequest request) {
    ingestUseCases.ack(request);
  }

  public SyncDtos.SyncStatusResponse status(long storeId) {
    return feedUseCases.status(storeId);
  }

  public long publishCentralEvent(SyncDtos.CentralOutboxPublishRequest request) {
    return outboxUseCases.publishCentralEvent(request);
  }

  public SyncDtos.ProvisionSyncNodeResponse provisionNode(SyncDtos.ProvisionSyncNodeRequest request) {
    return nodeLifecycleUseCases.provisionNode(request);
  }

  public SyncDtos.RotateSyncNodeSecretResponse rotateNodeSecret(String nodeId) {
    return nodeLifecycleUseCases.rotateNodeSecret(nodeId);
  }

  public void revokeNode(String nodeId) {
    nodeLifecycleUseCases.revokeNode(nodeId);
  }

  public SyncDtos.SyncHandshakeResponse handshake(SyncDtos.SyncHandshakeRequest request) {
    return nodeLifecycleUseCases.handshake(request);
  }
}
