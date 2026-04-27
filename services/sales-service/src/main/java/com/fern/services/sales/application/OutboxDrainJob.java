package com.fern.services.sales.application;

import com.dorabets.common.outbox.OutboxRelay;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Drains the shared outbox on a fixed cadence.
 * Disable in tests with property <code>outbox.relay.enabled=false</code>.
 */
@Component
@ConditionalOnProperty(name = "outbox.relay.enabled", havingValue = "true", matchIfMissing = true)
public class OutboxDrainJob {

    private static final Logger log = LoggerFactory.getLogger(OutboxDrainJob.class);

    private final OutboxRelay outboxRelay;

    public OutboxDrainJob(OutboxRelay outboxRelay) {
        this.outboxRelay = outboxRelay;
    }

    @Scheduled(fixedDelayString = "${outbox.relay.fixed-delay-ms:1000}", initialDelay = 5_000L)
    public void drain() {
        try {
            outboxRelay.drain();
        } catch (RuntimeException e) {
            log.warn("outbox drain failed: {}", e.getMessage());
        }
    }
}
