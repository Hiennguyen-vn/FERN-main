package com.fern.services.sales.application.kitchen;

import java.util.List;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "fern.kitchen.sla-job-enabled", havingValue = "true", matchIfMissing = true)
public class KitchenSlaJob {

  private static final Logger log = LoggerFactory.getLogger(KitchenSlaJob.class);

  private final KitchenTicketService kitchenTicketService;

  public KitchenSlaJob(KitchenTicketService kitchenTicketService) {
    this.kitchenTicketService = kitchenTicketService;
  }

  @Scheduled(
      fixedDelayString = "${fern.kitchen.sla-job-ms:30000}",
      initialDelayString = "${fern.kitchen.sla-job-initial-delay-ms:15000}"
  )
  @SchedulerLock(name = "kitchen-sla-sweeper", lockAtMostFor = "PT1M", lockAtLeastFor = "PT5S")
  public void sweep() {
    try {
      List<Long> breached = kitchenTicketService.claimSlaBreaches();
      if (breached.isEmpty()) return;
      log.info("kitchen sla breached count={}", breached.size());
      for (Long ticketId : breached) {
        kitchenTicketService.findOutletForTicket(ticketId).ifPresent(outletId ->
            kitchenTicketService.syncPublisher().publishSlaBreached(outletId, ticketId));
      }
    } catch (RuntimeException e) {
      log.warn("kitchen sla sweep failed: {}", e.getMessage());
    }
  }
}
