package com.natsu.common.utils.services.timing;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.function.Supplier;

public class TimingServiceImpl implements TimingService {

    // Stores start time in nanoseconds. Key is taskId.
    private final ConcurrentMap<String, Long> startTimes = new ConcurrentHashMap<>();

    @Override
    public void start(String taskId) {
        if (taskId == null || taskId.trim().isEmpty()) {
            throw new IllegalArgumentException("Task ID cannot be null or empty");
        }

        long tempStart = System.nanoTime();
        Long existing = startTimes.putIfAbsent(taskId, tempStart);

        if (existing != null) {
            throw new IllegalStateException("Timer already active for task: " + taskId);
        }
    }

    @Override
    public long stop(String taskId) {
        if (taskId == null || taskId.trim().isEmpty()) {
            return 0;
        }

        Long startTime = startTimes.remove(taskId);

        if (startTime == null) {
            return 0; // Return 0 to indicate no measurement was recorded.
        }

        long endTime = System.nanoTime();
        long durationNano = endTime - startTime;

        // Convert nanoseconds to milliseconds.
        return durationNano / 1_000_000;
    }

    @Override
    public void measure(String taskId, Runnable action) {
        start(taskId);
        try {
            action.run();
        } finally {
            stop(taskId);
        }
    }

    @Override
    public <T> T measure(String taskId, Supplier<T> action) {
        start(taskId);
        try {
            return action.get();
        } finally {
            stop(taskId);
        }
    }
}
