package com.fern.services.sales.application;

import com.fern.common.repository.BaseRepository;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "fern.cache.idempotency-cleanup-enabled", havingValue = "true", matchIfMissing = true)
public class IdempotencyCacheCleanupJob extends BaseRepository {

    private static final Logger log = LoggerFactory.getLogger(IdempotencyCacheCleanupJob.class);

    private final int batchSize;
    private final int maxBatchesPerRun;

    public IdempotencyCacheCleanupJob(
        DataSource dataSource,
        @Value("${fern.cache.idempotency-cleanup-batch-size:5000}") int batchSize,
        @Value("${fern.cache.idempotency-cleanup-max-batches:10}") int maxBatchesPerRun
    ) {
        super(dataSource);
        this.batchSize = Math.max(1, batchSize);
        this.maxBatchesPerRun = Math.max(1, maxBatchesPerRun);
    }

    @Scheduled(
        fixedDelayString = "${fern.cache.idempotency-cleanup-ms:3600000}",
        initialDelayString = "${fern.cache.idempotency-cleanup-initial-delay-ms:60000}"
    )
    public void cleanupExpired() {
        try {
            int deleted = 0;
            for (int batch = 0; batch < maxBatchesPerRun; batch++) {
                int batchDeleted = deleteExpiredBatch();
                deleted += batchDeleted;
                if (batchDeleted < batchSize) {
                    break;
                }
            }
            if (deleted > 0) {
                log.info("deleted {} expired idempotency cache rows", deleted);
            } else {
                log.debug("no expired idempotency cache rows to delete");
            }
        } catch (RuntimeException e) {
            log.warn("idempotency cache cleanup failed: {}", e.getMessage());
        }
    }

    int deleteExpiredBatch() {
        String sql = """
            WITH expired AS (
              SELECT service_name, idempotency_key
              FROM core.idempotency_keys
              WHERE expires_at < NOW()
              ORDER BY expires_at
              LIMIT ?
            )
            DELETE FROM core.idempotency_keys k
            USING expired
            WHERE k.service_name = expired.service_name
              AND k.idempotency_key = expired.idempotency_key
            """;
        return executeInTransaction(conn -> {
            try (var ps = conn.prepareStatement(sql)) {
                ps.setInt(1, batchSize);
                return ps.executeUpdate();
            }
        });
    }
}
