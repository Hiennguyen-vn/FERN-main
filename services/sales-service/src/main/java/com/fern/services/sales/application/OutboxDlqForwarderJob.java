package com.fern.services.sales.application;

import com.fern.common.outbox.OutboxDlqForwarder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "outbox.dlq.enabled", havingValue = "true", matchIfMissing = true)
public class OutboxDlqForwarderJob {

    private static final Logger log = LoggerFactory.getLogger(OutboxDlqForwarderJob.class);

    private final OutboxDlqForwarder outboxDlqForwarder;

    public OutboxDlqForwarderJob(OutboxDlqForwarder outboxDlqForwarder) {
        this.outboxDlqForwarder = outboxDlqForwarder;
    }

    @Scheduled(fixedDelayString = "${outbox.dlq.fixed-delay-ms:5000}", initialDelay = 10_000L)
    public void drain() {
        try {
            outboxDlqForwarder.drain();
        } catch (RuntimeException e) {
            log.warn("outbox DLQ forwarder failed: {}", e.getMessage());
        }
    }
}
