package com.fern.services.sync.application;

import com.fern.services.sync.edge.TieredSyncFacade;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class StoreSyncAgentScheduler {

  private static final Logger log = LoggerFactory.getLogger(StoreSyncAgentScheduler.class);

  private final SyncProperties properties;
  private final TieredSyncFacade tieredSyncFacade;

  public StoreSyncAgentScheduler(SyncProperties properties, TieredSyncFacade tieredSyncFacade) {
    this.properties = properties;
    this.tieredSyncFacade = tieredSyncFacade;
  }

  @Scheduled(fixedDelayString = "${sync.upload-interval-seconds:15}000")
  public void uploadPendingEvents() {
    if (!shouldRunStoreAgent()) {
      return;
    }
    int sent = tieredSyncFacade.syncUp();
    if (sent > 0) {
      log.info("Store sync agent uploaded {} events", sent);
    }
  }

  @Scheduled(fixedDelayString = "${sync.download-interval-seconds:15}000")
  public void downloadCentralEvents() {
    if (!shouldRunStoreAgent()) {
      return;
    }
    try {
      int received = tieredSyncFacade.syncDown();
      if (received > 0) {
        log.info("Store sync agent downloaded {} central events", received);
      } else {
        log.debug("Store sync agent found no central events nodeId={} storeId={}",
            properties.getNodeId(), properties.getStoreId());
      }
    } catch (Exception e) {
      log.warn("Store sync agent download/apply failed nodeId={} storeId={}: {}",
          properties.getNodeId(), properties.getStoreId(), e.getMessage());
    }
  }

  private boolean shouldRunStoreAgent() {
    return RuntimeRoleSupport.isStoreRole(properties);
  }
}
