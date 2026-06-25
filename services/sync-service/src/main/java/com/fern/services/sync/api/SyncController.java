package com.fern.services.sync.api;

import com.fern.common.middleware.ServiceException;
import com.fern.common.spring.auth.RequestUserContext;
import com.fern.common.spring.auth.RequestUserContextHolder;
import com.fern.services.sync.application.SyncDownloadService;
import com.fern.services.sync.application.SyncInboxService;
import com.fern.services.sync.application.SyncNodeProvisioningService;
import com.fern.services.sync.application.SyncOutboxService;
import com.fern.services.sync.application.SyncStatusService;
import com.fern.services.sync.application.SyncUploadService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/sync")
public class SyncController {

  private final SyncUploadService uploadService;
  private final SyncDownloadService downloadService;
  private final SyncInboxService inboxService;
  private final SyncStatusService statusService;
  private final SyncOutboxService outboxService;
  private final SyncNodeProvisioningService nodeProvisioningService;

  public SyncController(
      SyncUploadService uploadService,
      SyncDownloadService downloadService,
      SyncInboxService inboxService,
      SyncStatusService statusService,
      SyncOutboxService outboxService,
      SyncNodeProvisioningService nodeProvisioningService
  ) {
    this.uploadService = uploadService;
    this.downloadService = downloadService;
    this.inboxService = inboxService;
    this.statusService = statusService;
    this.outboxService = outboxService;
    this.nodeProvisioningService = nodeProvisioningService;
  }

  @PostMapping("/upload")
  public SyncDtos.SyncUploadResponse upload(@Valid @RequestBody SyncDtos.SyncUploadRequest request) {
    return uploadService.upload(request);
  }

  @GetMapping("/download")
  public SyncDtos.SyncDownloadResponse download(
      @RequestParam long storeId,
      @RequestParam(required = false) String cursor,
      @RequestParam(required = false) Integer limit
  ) {
    return downloadService.download(storeId, cursor, limit);
  }

  @PostMapping("/ack")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void ack(@Valid @RequestBody SyncDtos.SyncAckRequest request) {
    inboxService.ack(request);
  }

  @GetMapping("/status/{storeId}")
  public SyncDtos.SyncStatusResponse status(@PathVariable long storeId) {
    return statusService.status(storeId);
  }

  @PostMapping("/internal/central-outbox")
  @ResponseStatus(HttpStatus.CREATED)
  public java.util.Map<String, Object> publishCentralEvent(
      @Valid @RequestBody SyncDtos.CentralOutboxPublishRequest request
  ) {
    requireSyncNodeAdmin();
    return java.util.Map.of("eventId", Long.toString(outboxService.publishCentralEvent(request)));
  }

  @PostMapping("/internal/nodes/provision")
  @ResponseStatus(HttpStatus.CREATED)
  public SyncDtos.ProvisionSyncNodeResponse provisionNode(
      @Valid @RequestBody SyncDtos.ProvisionSyncNodeRequest request
  ) {
    requireSyncNodeAdmin();
    return nodeProvisioningService.provision(request);
  }

  @PostMapping("/internal/nodes/{nodeId}/rotate-secret")
  public SyncDtos.RotateSyncNodeSecretResponse rotateNodeSecret(@PathVariable String nodeId) {
    requireSyncNodeAdmin();
    return nodeProvisioningService.rotateSecret(nodeId);
  }

  @PostMapping("/internal/nodes/{nodeId}/revoke")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void revokeNode(@PathVariable String nodeId) {
    requireSyncNodeAdmin();
    nodeProvisioningService.revoke(nodeId);
  }

  @PostMapping("/handshake")
  public SyncDtos.SyncHandshakeResponse handshake(@Valid @RequestBody SyncDtos.SyncHandshakeRequest request) {
    return nodeProvisioningService.handshake(request);
  }

  private void requireSyncNodeAdmin() {
    RequestUserContext context = RequestUserContextHolder.get();
    if (context.internalService()
        || context.hasRole("superadmin")
        || context.hasPermission("sync:nodes:manage")
        || context.hasPermission("sync:nodes:provision")) {
      return;
    }
    throw ServiceException.forbidden("Sync node administration permission is required");
  }
}
