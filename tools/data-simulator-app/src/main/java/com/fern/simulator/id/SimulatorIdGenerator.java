package com.fern.simulator.id;

import com.natsu.common.utils.services.id.SnowflakeIdGenerator;

/**
 * Simulator-specific ID generator wrapping {@link SnowflakeIdGenerator}.
 * <p>
 * Uses the explicit {@code workerId} constructor to avoid requiring
 * {@code ServicesRegistry} registration, which is unnecessary for a CLI tool.
 * <p>
 * Adds retry logic for clock-backwards errors that occur during high-speed
 * dry-run simulations (no DB I/O to throttle generation speed).
 */
public final class SimulatorIdGenerator {

    /** Fixed worker ID for the simulator. Offset to avoid collision with service instances. */
    private static final long SIMULATOR_WORKER_ID = 900L;

    /** Maximum wall-clock wait when recovering from small clock skews. */
    private static final long MAX_RECOVERY_WAIT_MS = 256L;

    private final SnowflakeIdGenerator generator;

    public SimulatorIdGenerator() {
        this(SIMULATOR_WORKER_ID);
    }

    public SimulatorIdGenerator(long workerId) {
        this.generator = new SnowflakeIdGenerator(workerId);
    }

    /**
     * Generate a unique Snowflake ID.
     * Retries with a short sleep on clock-backwards errors (common in
     * dry-run mode where simulation runs faster than wall-clock time).
     */
    public synchronized long nextId() {
        long waitedMs = 0;
        long sleepMs = 1;

        while (waitedMs <= MAX_RECOVERY_WAIT_MS) {
            try {
                return generator.generateId();
            } catch (RuntimeException e) {
                if (e.getMessage() != null && e.getMessage().contains("Clock moved backwards")) {
                    try {
                        Thread.sleep(sleepMs);
                        waitedMs += sleepMs;
                        sleepMs = Math.min(sleepMs * 2, 32L);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        throw e;
                    }
                } else {
                    throw e;
                }
            }
        }

        throw new RuntimeException("Clock moved backwards for more than "
                + MAX_RECOVERY_WAIT_MS + "ms while generating simulator IDs");
    }
}
