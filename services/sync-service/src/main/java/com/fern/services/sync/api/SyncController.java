package com.fern.services.sync.api;

import com.fern.common.middleware.ServiceException;
import com.fern.common.spring.auth.RequestUserContext;
import com.fern.common.spring.auth.RequestUserContextHolder;
import com.fern.services.sync.central.CentralSyncFacade;
import com.fern.services.sync.hub.RegionalHubFacade;
import com.fern.services.sync.shared.SyncRuntimeRoleResolver;
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

  private final CentralSyncFacade centralSyncFacade;
  private final RegionalHubFacade regionalHubFacade;
  private final SyncRuntimeRoleResolver runtimeRoleResolver;

  public SyncController(
      CentralSyncFacade centralSyncFacade,
      RegionalHubFacade regionalHubFacade,
      SyncRuntimeRoleResolver runtimeRoleResolver
  ) {
    this.centralSyncFacade = centralSyncFacade;
    this.regionalHubFacade = regionalHubFacade;
    this.runtimeRoleResolver = runtimeRoleResolver;
  }

  // Ingest endpoints
  @PostMapping("/upload")
  public SyncDtos.SyncUploadResponse upload(@Valid @RequestBody SyncDtos.SyncUploadRequest request) {
    if (runtimeRoleResolver.isHubRole()) {
      return regionalHubFacade.upload(request);
    }
    return centralSyncFacade.upload(request);
  }

  @GetMapping("/download")
  public SyncDtos.SyncDownloadResponse download(
      @RequestParam long storeId,
      @RequestParam(required = false) String cursor,
      @RequestParam(required = false) Integer limit
  ) {
    if (runtimeRoleResolver.isHubRole()) {
      return regionalHubFacade.download(storeId, cursor, limit);
    }
    return centralSyncFacade.download(storeId, cursor, limit);
  }

  @PostMapping("/ack")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void ack(@Valid @RequestBody SyncDtos.SyncAckRequest request) {
    if (runtimeRoleResolver.isHubRole()) {
      regionalHubFacade.ack(request);
      return;
    }
    centralSyncFacade.ack(request);
  }

  // Feed endpoints
  @GetMapping("/status/{storeId}")
  public SyncDtos.SyncStatusResponse status(@PathVariable long storeId) {
    if (runtimeRoleResolver.isHubRole()) {
      return regionalHubFacade.status(storeId);
    }
    return centralSyncFacade.status(storeId);
  }

  @PostMapping("/internal/central-outbox")
  @ResponseStatus(HttpStatus.CREATED)
  public java.util.Map<String, Object> publishCentralEvent(
      @Valid @RequestBody SyncDtos.CentralOutboxPublishRequest request
  ) {
    requireSyncNodeAdmin();
    if (runtimeRoleResolver.isHubRole()) {
      return java.util.Map.of("eventId", Long.toString(regionalHubFacade.publishCentralEvent(request)));
    }
    return java.util.Map.of("eventId", Long.toString(centralSyncFacade.publishCentralEvent(request)));
  }

  // Node lifecycle endpoints
  @PostMapping("/internal/nodes/provision")
  @ResponseStatus(HttpStatus.CREATED)
  public SyncDtos.ProvisionSyncNodeResponse provisionNode(
      @Valid @RequestBody SyncDtos.ProvisionSyncNodeRequest request
  ) {
    requireSyncNodeAdmin();
    if (runtimeRoleResolver.isHubRole()) {
      return regionalHubFacade.provisionNode(request);
    }
    return centralSyncFacade.provisionNode(request);
  }

  @PostMapping("/internal/nodes/{nodeId}/rotate-secret")
  public SyncDtos.RotateSyncNodeSecretResponse rotateNodeSecret(@PathVariable String nodeId) {
    requireSyncNodeAdmin();
    if (runtimeRoleResolver.isHubRole()) {
      return regionalHubFacade.rotateNodeSecret(nodeId);
    }
    return centralSyncFacade.rotateNodeSecret(nodeId);
  }

  @PostMapping("/internal/nodes/{nodeId}/revoke")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void revokeNode(@PathVariable String nodeId) {
    requireSyncNodeAdmin();
    if (runtimeRoleResolver.isHubRole()) {
      regionalHubFacade.revokeNode(nodeId);
      return;
    }
    centralSyncFacade.revokeNode(nodeId);
  }

  @PostMapping("/handshake")
  public SyncDtos.SyncHandshakeResponse handshake(@Valid @RequestBody SyncDtos.SyncHandshakeRequest request) {
    if (runtimeRoleResolver.isHubRole()) {
      return regionalHubFacade.handshake(request);
    }
    return centralSyncFacade.handshake(request);
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
