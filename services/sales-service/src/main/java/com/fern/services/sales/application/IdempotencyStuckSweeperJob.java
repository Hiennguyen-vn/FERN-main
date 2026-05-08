package com.fern.services.sales.application;

import com.fern.common.idempotency.IdempotencyGuard;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Periodic sweeper that recovers idempotency rows stuck in the {@code started} state.
 *
 * <p>A row is inserted with {@code status='started'} before the business handler runs and
 * updated to {@code completed} or {@code failed} afterwards. If the JVM crashes in the
 * window between those two DB writes, the row stays in {@code started} forever, causing
 * every subsequent retry to receive {@code IdempotencyInProgressException} until the TTL
 * expires (up to 30 days for WITHDRAWAL policy).
 *
 * <p>This job calls {@link IdempotencyGuard#recoverStuck} on a fixed schedule and relies on
 * ShedLock to ensure only one instance runs the sweep at a time in a multi-node deployment.
 */
@Component
@ConditionalOnProperty(
    name = "fern.idempotency.stuck-sweeper-enabled",
    havingValue = "true",
    matchIfMissing = true
)
public class IdempotencyStuckSweeperJob {

  private static final Logger log = LoggerFactory.getLogger(IdempotencyStuckSweeperJob.class);

  private final IdempotencyGuard guard;
  private final int stalenessSeconds;
  private final int batchSize;

  public IdempotencyStuckSweeperJob(
      IdempotencyGuard guard,
      @Value("${fern.idempotency.stuck-staleness-seconds:300}") int stalenessSeconds,
      @Value("${fern.idempotency.stuck-batch-size:200}") int batchSize
  ) {
    this.guard = guard;
    this.stalenessSeconds = Math.max(60, stalenessSeconds);
    this.batchSize = Math.max(1, batchSize);
  }

  @Scheduled(
      fixedDelayString = "${fern.idempotency.stuck-sweeper-delay-ms:60000}",
      initialDelayString = "${fern.idempotency.stuck-sweeper-initial-delay-ms:30000}"
  )
  @SchedulerLock(name = "idempotency-stuck-sweeper", lockAtMostFor = "PT10M", lockAtLeastFor = "PT15S")
  public void sweep() {
    try {
      int recovered = guard.recoverStuck(stalenessSeconds, batchSize);
      if (recovered > 0) {
        log.warn("idempotency-stuck-sweeper: recovered {} orphaned 'started' row(s) "
            + "(staleness={}s, batch={})", recovered, stalenessSeconds, batchSize);
      } else {
        log.debug("idempotency-stuck-sweeper: no stuck rows found");
      }
    } catch (Exception e) {
      log.warn("idempotency-stuck-sweeper: sweep failed: {}", e.getMessage());
    }
  }
}
