package com.fern.services.sync.application;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "sync")
public class SyncProperties {

  private SyncMode mode = SyncMode.CENTRAL;
  private boolean enabled = true;
  private int uploadIntervalSeconds = 15;
  private int downloadIntervalSeconds = 15;
  private int batchSize = 100;
  private String centralSyncUrl = "http://localhost:8094";
  private String nodeId = "";
  private String nodeCode = "";
  private String storeId = "";

  public enum SyncMode {
    CENTRAL,
    STORE
  }

  public SyncMode getMode() {
    return mode;
  }

  public void setMode(SyncMode mode) {
    this.mode = mode;
  }

  public boolean isEnabled() {
    return enabled;
  }

  public void setEnabled(boolean enabled) {
    this.enabled = enabled;
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
}
