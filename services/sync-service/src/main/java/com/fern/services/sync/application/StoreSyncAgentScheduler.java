package com.fern.services.sync.application;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class StoreSyncAgentScheduler {

  private static final Logger log = LoggerFactory.getLogger(StoreSyncAgentScheduler.class);

  private final SyncProperties properties;
  private final StoreSyncAgentService storeSyncAgentService;

  public StoreSyncAgentScheduler(SyncProperties properties, StoreSyncAgentService storeSyncAgentService) {
    this.properties = properties;
    this.storeSyncAgentService = storeSyncAgentService;
  }

  @Scheduled(fixedDelayString = "${sync.upload-interval-seconds:15}000")
  public void uploadPendingEvents() {
    if (!shouldRunStoreAgent()) {
      return;
    }
    int sent = storeSyncAgentService.uploadPendingEvents();
    if (sent > 0) {
      log.info("Store sync agent uploaded {} events", sent);
    }
  }

  @Scheduled(fixedDelayString = "${sync.download-interval-seconds:15}000")
  public void downloadCentralEvents() {
    if (!shouldRunStoreAgent()) {
      return;
    }
    log.debug("Store sync agent download tick centralSyncUrl={} nodeId={} storeId={}",
        properties.getCentralSyncUrl(), properties.getNodeId(), properties.getStoreId());
  }

  private boolean shouldRunStoreAgent() {
    return properties.isEnabled() && properties.getMode() == SyncProperties.SyncMode.STORE;
  }
}
