package com.fern.services.masternode.application;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class ControlPlaneSweepScheduler {

  private final ControlPlaneRegistryService registryService;

  public ControlPlaneSweepScheduler(ControlPlaneRegistryService registryService) {
    this.registryService = registryService;
  }

  @Scheduled(
      initialDelayString = "#{${fern.control.heartbeatIntervalSeconds:${dependencies.masterNode.heartbeatIntervalSeconds:10}} * 1000}",
      fixedDelayString = "#{${fern.control.heartbeatIntervalSeconds:${dependencies.masterNode.heartbeatIntervalSeconds:10}} * 1000}"
  )
  public void pruneExpiredInstances() {
    registryService.pruneExpiredInstances();
  }
}
