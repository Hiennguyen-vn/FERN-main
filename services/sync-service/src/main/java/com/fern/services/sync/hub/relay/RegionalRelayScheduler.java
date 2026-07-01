package com.fern.services.sync.hub.relay;

import com.fern.services.sync.application.SyncProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class RegionalRelayScheduler {

  private static final Logger log = LoggerFactory.getLogger(RegionalRelayScheduler.class);

  private final SyncProperties properties;
  private final RegionalUpstreamRelayUseCase relayUseCase;

  public RegionalRelayScheduler(SyncProperties properties, RegionalUpstreamRelayUseCase relayUseCase) {
    this.properties = properties;
    this.relayUseCase = relayUseCase;
  }

  @Scheduled(fixedDelayString = "${sync.upload-interval-seconds:15}000")
  public void relayAcceptedHubIngestToCentral() {
    if (!shouldRunRelay()) {
      return;
    }
    int relayed = relayUseCase.relayToCentral();
    if (relayed > 0) {
      log.info("Regional relay uploaded {} child events to central", relayed);
    }
  }

  private boolean shouldRunRelay() {
    return properties.isEnabled()
        && properties.effectiveRole() == SyncProperties.SyncRuntimeRole.REGIONAL_HUB;
  }
}
