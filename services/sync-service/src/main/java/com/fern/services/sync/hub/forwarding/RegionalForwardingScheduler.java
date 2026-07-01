package com.fern.services.sync.hub.forwarding;

import com.fern.services.sync.application.SyncProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class RegionalForwardingScheduler {

  private static final Logger log = LoggerFactory.getLogger(RegionalForwardingScheduler.class);

  private final SyncProperties properties;
  private final RegionalCentralForwardingUseCase forwardingUseCase;

  public RegionalForwardingScheduler(SyncProperties properties, RegionalCentralForwardingUseCase forwardingUseCase) {
    this.properties = properties;
    this.forwardingUseCase = forwardingUseCase;
  }

  @Scheduled(fixedDelayString = "${sync.download-interval-seconds:15}000")
  public void forwardCentralFeedToManagedOutlets() {
    if (!shouldRunForwarder()) {
      return;
    }
    try {
      int forwarded = forwardingUseCase.forwardFromCentral();
      if (forwarded > 0) {
        log.info("Regional forwarding forwarded {} downstream events", forwarded);
      } else {
        log.debug("Regional forwarding found no central events nodeId={} storeId={}",
            properties.getNodeId(), properties.getStoreId());
      }
    } catch (Exception e) {
      log.warn("Regional forwarding failed nodeId={} storeId={}: {}",
          properties.getNodeId(), properties.getStoreId(), e.getMessage());
    }
  }

  private boolean shouldRunForwarder() {
    return properties.isEnabled()
        && properties.effectiveRole() == SyncProperties.SyncRuntimeRole.REGIONAL_HUB;
  }
}
