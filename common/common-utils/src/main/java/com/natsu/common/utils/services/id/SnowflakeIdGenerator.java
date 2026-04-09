package com.natsu.common.utils.services.id;

import com.natsu.common.utils.services.ServiceCategory;
import com.natsu.common.utils.services.ServicesRegistry;

/**
 * An ID Generator that creates unique 64-bit numerical identifiers utilizing
 * the
 * Snowflake algorithm concept.
 *
 * Requirements:
 * <ul>
 * <li>Custom Epoch: Starts from Jan 1st 2000 (UTC)</li>
 * <li>10-bit machine identifier allocation</li>
 * <li>12-bit sequence number per millisecond</li>
 * </ul>
 */
public class SnowflakeIdGenerator implements IdGenerator {

    /**
     * Custom Epoch: 2000-01-01T00:00:00Z
     */
    public static final long CUSTOM_EPOCH = 946684800000L;

    private static final long WORKER_ID_BITS = 10L;
    private static final long SEQUENCE_BITS = 12L;

    public static final long MAX_WORKER_ID = ~(-1L << WORKER_ID_BITS);
    private static final long SEQUENCE_MASK = ~(-1L << SEQUENCE_BITS);

    private static final long WORKER_ID_SHIFT = SEQUENCE_BITS;
    private static final long TIMESTAMP_LEFT_SHIFT = SEQUENCE_BITS + WORKER_ID_BITS;

    private final long workerId;

    private long sequence = 0L;
    private long lastTimestamp = -1L;

    /**
     * Default constructor automatically resolves the worker ID from the
     * {@link ServicesRegistry}.
     * To use this constructor, a {@link MachineIdConfig} must have been registered.
     */
    public SnowflakeIdGenerator() {
        MachineIdConfig config = ServicesRegistry.getConfigOrNull("machine-id", ServiceCategory.CUSTOM);
        if (config == null) {
            throw new IllegalStateException(
                    "MachineIdConfig is not registered in ServicesRegistry under custom 'machine-id'");
        }

        long id = config.machineId();
        if (id < 0 || id > MAX_WORKER_ID) {
            throw new IllegalArgumentException(
                    String.format("Worker ID %d can't be greater than %d or less than 0", id, MAX_WORKER_ID));
        }

        this.workerId = id;
    }

    /**
     * Constructor allowing to manually override the worker ID.
     * Only mostly used for testing cases where registry is mocked/unavailable.
     *
     * @param workerId the dedicated machine worker ID
     */
    public SnowflakeIdGenerator(long workerId) {
        if (workerId < 0 || workerId > MAX_WORKER_ID) {
            throw new IllegalArgumentException(
                    String.format("Worker ID %d can't be greater than %d or less than 0", workerId, MAX_WORKER_ID));
        }
        this.workerId = workerId;
    }

    @Override
    public synchronized long generateId() {
        long timestamp = timeGen();

        if (timestamp < lastTimestamp) {
            throw new RuntimeException(String.format(
                    "Clock moved backwards. Refusing to generate id for %d milliseconds", lastTimestamp - timestamp));
        }

        if (lastTimestamp == timestamp) {
            sequence = (sequence + 1) & SEQUENCE_MASK;
            if (sequence == 0) {
                timestamp = tilNextMillis(lastTimestamp);
            }
        } else {
            sequence = 0L;
        }

        lastTimestamp = timestamp;

        return ((timestamp - CUSTOM_EPOCH) << TIMESTAMP_LEFT_SHIFT)
                | (workerId << WORKER_ID_SHIFT)
                | sequence;
    }

    protected long tilNextMillis(long lastTimestamp) {
        long timestamp = timeGen();
        while (timestamp <= lastTimestamp) {
            timestamp = timeGen();
        }
        return timestamp;
    }

    protected long timeGen() {
        return System.currentTimeMillis();
    }
}
