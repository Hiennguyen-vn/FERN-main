package com.natsu.common.utils.services.timing;

import java.util.function.Supplier;

public interface TimingService {

    /**
     * Starts a timer for the given task ID.
     *
     * @param taskId Unique identifier for the task.
     * @throws IllegalStateException    if a timer for the given taskId is already
     *                                  running.
     * @throws IllegalArgumentException if taskId is null or empty.
     */
    void start(String taskId);

    /**
     * Stops the timer for the given task ID and returns the duration in
     * milliseconds.
     * This method is idempotent and safe to call multiple times; if the timer is
     * not found
     * (e.g. already stopped), it returns 0 (or -1 to indicate missing, depending on
     * impl).
     *
     * @param taskId Unique identifier for the task.
     * @return Execution duration in milliseconds, or 0 if the timer was not found.
     */
    long stop(String taskId);

    /**
     * Helper to measure the execution time of a Runnable task.
     * Automatically handles start and stop.
     *
     * @param taskId Unique identifier for the task.
     * @param action The task to execute.
     */
    void measure(String taskId, Runnable action);

    /**
     * Helper to measure the execution time of a Supplier task.
     * Automatically handles start and stop.
     *
     * @param taskId Unique identifier for the task.
     * @param action The task to execute.
     * @param <T>    The return type of the task.
     * @return The result of the task execution.
     */
    <T> T measure(String taskId, Supplier<T> action);
}
