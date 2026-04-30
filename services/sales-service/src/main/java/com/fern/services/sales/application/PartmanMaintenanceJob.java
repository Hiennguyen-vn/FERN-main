package com.fern.services.sales.application;

import com.fern.common.repository.BaseRepository;
import javax.sql.DataSource;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class PartmanMaintenanceJob extends BaseRepository {

    private static final Logger log = LoggerFactory.getLogger(PartmanMaintenanceJob.class);

    public PartmanMaintenanceJob(DataSource dataSource) {
        super(dataSource);
    }

    // 3AM daily — runs partman maintenance: creates future partitions, drops expired ones.
    @Scheduled(cron = "0 0 3 * * *")
    @SchedulerLock(name = "partman-maintenance", lockAtMostFor = "PT30M", lockAtLeastFor = "PT1M")
    public void runMaintenance() {
        try {
            executeInTransaction(conn -> {
                try (var ps = conn.prepareStatement("SELECT partman.run_maintenance()")) {
                    ps.execute();
                }
                return null;
            });
            log.info("pg_partman maintenance completed");
        } catch (Exception e) {
            log.error("pg_partman maintenance failed", e);
        }
    }
}
