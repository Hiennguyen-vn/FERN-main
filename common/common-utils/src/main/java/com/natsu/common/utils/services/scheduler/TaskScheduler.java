package com.natsu.common.utils.services.scheduler;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

public interface TaskScheduler {

    /**
     * Registers a task definition.
     * Duplicate registration attempts for the same taskId will throw
     * IllegalStateException
     * unless explicitly allowed by implementation policy (default: strict).
     *
     * @param taskId Unique identifier.
     * @param task   The executable logic.
     */
    void register(String taskId, Runnable task);

    /**
     * Unregisters a task and cancels any pending scheduled executions for it.
     *
     * @param taskId Unique identifier.
     */
    void unregister(String taskId);

    /**
     * Manually triggers a registered task immediately in the current thread (sync)
     * or submits it to the executor (if the task itself is async/wrapped).
     * <p>
     * Note: This method blocks until the runnable completes.
     *
     * @param taskId Unique identifier.
     */
    void run(String taskId);

    /**
     * Manually triggers a registered task asynchronously.
     *
     * @param taskId Unique identifier.
     * @return A CompletableFuture representing the execution.
     */
    CompletableFuture<Void> runAsync(String taskId);

    /**
     * Schedules a one-shot execution of a registered task after a delay.
     *
     * @param taskId Unique identifier.
     * @param delay  Delay duration.
     * @param unit   Time unit.
     */
    void schedule(String taskId, long delay, TimeUnit unit);

    /**
     * Schedules a recurring execution of a registered task.
     *
     * @param taskId       Unique identifier.
     * @param initialDelay Initial delay before first execution.
     * @param period       Period between successive executions.
     * @param unit         Time unit.
     */
    void scheduleAtFixedRate(String taskId, long initialDelay, long period, TimeUnit unit);

    /**
     * Cancels any active scheduling for the given task.
     * Does not unregister the task definition.
     *
     * @param taskId Unique identifier.
     * @return true if a scheduled task was found and cancelled.
     */
    boolean cancel(String taskId);
}
