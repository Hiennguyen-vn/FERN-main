package com.fern.services.sync.application;

import jakarta.annotation.PostConstruct;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import com.fern.services.sync.shared.SyncTier;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties(prefix = "sync")
public class SyncProperties {

  private SyncMode mode = SyncMode.CENTRAL;
  private SyncRuntimeRole runtimeRole;
  private boolean enabled = true;
  private boolean downstreamEnabled = false;
  @Min(1)
  private int uploadIntervalSeconds = 15;
  @Min(1)
  private int downloadIntervalSeconds = 15;
  @Min(1)
  private int batchSize = 100;
  @NotBlank
  private String centralSyncUrl = "http://sync-service:8094";
  private SyncTier tier;
  private String nodeId = "";
  private String nodeCode = "";
  private String storeId = "";
  private String parentNodeId = "";
  private Long managedScopeId;

  public enum SyncMode {
    CENTRAL,
    STORE
  }

  public enum SyncRuntimeRole {
    MASTER_CENTRAL,
    REGIONAL_HUB,
    OUTLET_EDGE
  }

  public SyncMode getMode() {
    return mode;
  }

  public void setMode(SyncMode mode) {
    this.mode = mode;
  }

  public SyncRuntimeRole getRuntimeRole() {
    return runtimeRole;
  }

  public void setRuntimeRole(SyncRuntimeRole runtimeRole) {
    this.runtimeRole = runtimeRole;
  }

  public boolean isEnabled() {
    return enabled;
  }

  public void setEnabled(boolean enabled) {
    this.enabled = enabled;
  }

  public boolean isDownstreamEnabled() {
    return downstreamEnabled;
  }

  public void setDownstreamEnabled(boolean downstreamEnabled) {
    this.downstreamEnabled = downstreamEnabled;
  }

  public int getUploadIntervalSeconds() {
    return uploadIntervalSeconds;
  }

  public void setUploadIntervalSeconds(int uploadIntervalSeconds) {
    this.uploadIntervalSeconds = uploadIntervalSeconds;
  }

  public int getDownloadIntervalSeconds() {
    return downloadIntervalSeconds;
  }

  public void setDownloadIntervalSeconds(int downloadIntervalSeconds) {
    this.downloadIntervalSeconds = downloadIntervalSeconds;
  }

  public int getBatchSize() {
    return batchSize;
  }

  public void setBatchSize(int batchSize) {
    this.batchSize = batchSize;
  }

  public String getCentralSyncUrl() {
    return centralSyncUrl;
  }

  public void setCentralSyncUrl(String centralSyncUrl) {
    this.centralSyncUrl = centralSyncUrl;
  }

  public SyncTier getTier() {
    return tier;
  }

  public void setTier(SyncTier tier) {
    this.tier = tier;
  }

  public String getNodeId() {
    return nodeId;
  }

  public void setNodeId(String nodeId) {
    this.nodeId = nodeId;
  }

  public String getNodeCode() {
    return nodeCode;
  }

  public void setNodeCode(String nodeCode) {
    this.nodeCode = nodeCode;
  }

  public String getStoreId() {
    return storeId;
  }

  public void setStoreId(String storeId) {
    this.storeId = storeId;
  }

  public String getParentNodeId() {
    return parentNodeId;
  }

  public void setParentNodeId(String parentNodeId) {
    this.parentNodeId = parentNodeId;
  }

  public Long getManagedScopeId() {
    return managedScopeId;
  }

  public void setManagedScopeId(Long managedScopeId) {
    this.managedScopeId = managedScopeId;
  }

  @PostConstruct
  void validateModeSpecificRequirements() {
    SyncTier effectiveTier = effectiveTier();
    if (effectiveRole() == SyncRuntimeRole.OUTLET_EDGE || effectiveRole() == SyncRuntimeRole.REGIONAL_HUB
        || effectiveTier == SyncTier.OUTLET || effectiveTier == SyncTier.REGIONAL) {
      if (nodeId == null || nodeId.isBlank()) {
        throw new IllegalStateException("sync.node-id is required for OUTLET or REGIONAL tier");
      }
      if (storeId == null || storeId.isBlank()) {
        throw new IllegalStateException("sync.store-id is required for OUTLET or REGIONAL tier");
      }
      try {
        Long.parseLong(storeId.trim());
      } catch (NumberFormatException ex) {
        throw new IllegalStateException("sync.store-id must be a numeric store id", ex);
      }
    }
  }

  public SyncTier effectiveTier() {
    if (tier != null) {
      return tier;
    }
    return mode == SyncMode.STORE ? SyncTier.OUTLET : SyncTier.MASTER;
  }

  public SyncRuntimeRole effectiveRole() {
    if (runtimeRole != null) {
      return runtimeRole;
    }
    return switch (effectiveTier()) {
      case MASTER -> SyncRuntimeRole.MASTER_CENTRAL;
      case REGIONAL, OUTLET -> SyncRuntimeRole.OUTLET_EDGE;
    };
  }
}
