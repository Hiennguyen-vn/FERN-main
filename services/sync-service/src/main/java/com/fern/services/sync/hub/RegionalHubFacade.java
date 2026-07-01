package com.fern.services.sync.hub;

import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.hub.feed.RegionalHubFeedUseCases;
import com.fern.services.sync.hub.ingest.RegionalHubIngestUseCases;
import com.fern.services.sync.hub.status.RegionalHubStatusUseCases;
import org.springframework.stereotype.Service;

@Service
public class RegionalHubFacade {

  private final RegionalHubIngestUseCases ingestUseCases;
  private final RegionalHubFeedUseCases feedUseCases;
  private final RegionalHubStatusUseCases statusUseCases;
  private final RegionalHubNodeLifecycleUseCases nodeLifecycleUseCases;

  public RegionalHubFacade(
      RegionalHubIngestUseCases ingestUseCases,
      RegionalHubFeedUseCases feedUseCases,
      RegionalHubStatusUseCases statusUseCases,
      RegionalHubNodeLifecycleUseCases nodeLifecycleUseCases
  ) {
    this.ingestUseCases = ingestUseCases;
    this.feedUseCases = feedUseCases;
    this.statusUseCases = statusUseCases;
    this.nodeLifecycleUseCases = nodeLifecycleUseCases;
  }

  public SyncDtos.SyncUploadResponse upload(SyncDtos.SyncUploadRequest request) {
    return ingestUseCases.upload(request);
  }

  public SyncDtos.SyncDownloadResponse download(long storeId, String cursor, Integer limit) {
    return feedUseCases.downloadForManagedStore(storeId, cursor, limit);
  }

  public void ack(SyncDtos.SyncAckRequest request) {
    feedUseCases.ack(request);
  }

  public SyncDtos.SyncStatusResponse status(long storeId) {
    return statusUseCases.statusForManagedStore(storeId);
  }

  public long publishCentralEvent(SyncDtos.CentralOutboxPublishRequest request) {
    return nodeLifecycleUseCases.publishForManagedChildren(request);
  }

  public SyncDtos.ProvisionSyncNodeResponse provisionNode(SyncDtos.ProvisionSyncNodeRequest request) {
    return nodeLifecycleUseCases.provisionManagedNode(request);
  }

  public SyncDtos.RotateSyncNodeSecretResponse rotateNodeSecret(String nodeId) {
    return nodeLifecycleUseCases.rotateManagedNodeSecret(nodeId);
  }

  public void revokeNode(String nodeId) {
    nodeLifecycleUseCases.revokeManagedNode(nodeId);
  }

  public SyncDtos.SyncHandshakeResponse handshake(SyncDtos.SyncHandshakeRequest request) {
    return nodeLifecycleUseCases.handshakeManagedNode(request);
  }
}
