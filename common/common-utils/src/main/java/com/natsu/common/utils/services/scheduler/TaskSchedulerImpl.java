package com.natsu.common.utils.services.scheduler;

import com.natsu.common.utils.services.timing.TimingService;

import java.util.concurrent.*;

public class TaskSchedulerImpl implements TaskScheduler {

    private final TimingService timingService;
    private final ScheduledExecutorService executor;

    // Store task logic
    private final ConcurrentMap<String, Runnable> taskDefinitions = new ConcurrentHashMap<>();

    // Store active scheduled futures for cancellation
    private final ConcurrentMap<String, ScheduledFuture<?>> activeTasks = new ConcurrentHashMap<>();

    /**
     * Creates a new TaskSchedulerImpl.
     * 
     * @param timingService The timing service for measuring execution.
     * @param poolSize      Size of the thread pool.
     */
    public TaskSchedulerImpl(TimingService timingService, int poolSize) {
        if (timingService == null) {
            throw new IllegalArgumentException("TimingService cannot be null");
        }
        this.timingService = timingService;
        this.executor = Executors.newScheduledThreadPool(poolSize, r -> {
            Thread t = new Thread(r);
            t.setName("scheduler-worker-" + t.getName());
            t.setDaemon(true); // Ensure it doesn't block JVM shutdown
            return t;
        });
    }

    /**
     * Default constructor with CPU core-based pool size.
     */
    public TaskSchedulerImpl(TimingService timingService) {
        this(timingService, Runtime.getRuntime().availableProcessors());
    }

    // For testing/shutdown
    public void shutdown() {
        executor.shutdown();
    }

    @Override
    public void register(String taskId, Runnable task) {
        if (taskId == null || taskId.isBlank())
            throw new IllegalArgumentException("TaskId cannot be null/empty");
        if (task == null)
            throw new IllegalArgumentException("Task runnable cannot be null");

        // Atomic check-and-put. Fail if exists.
        if (taskDefinitions.putIfAbsent(taskId, task) != null) {
            throw new IllegalStateException("Task already registered: " + taskId);
        }
    }

    @Override
    public void unregister(String taskId) {
        if (taskId == null)
            return;
        cancel(taskId); // Ensure pending schedules are killed
        taskDefinitions.remove(taskId);
    }

    @Override
    public void run(String taskId) {
        Runnable task = getTaskOrThrow(taskId);
        // Execute directly in current thread, wrapped with timing
        timingService.measure(taskId, task);
    }

    @Override
    public CompletableFuture<Void> runAsync(String taskId) {
        Runnable task = getTaskOrThrow(taskId);

        return CompletableFuture.runAsync(() -> {
            // Execute in dedicated pool, wrapped with timing
            timingService.measure(taskId, task);
        }, executor);
    }

    @Override
    public void schedule(String taskId, long delay, TimeUnit unit) {
        Runnable task = getTaskOrThrow(taskId);

        // Cancel previous if any (LWW policy for same taskId schedule)
        // Or should we support multiple schedules?
        // "Duplicate register... must not overwrite".
        // "Support multiple concurrent timers".
        // For scheduling, typically one active schedule per ID is safer unless we track
        // multiple futures.
        // Let's implement: Scheduling REPLACES existing schedule for same ID to prevent
        // leak.

        // Wrap task with timing and cleanup
        Runnable wrappedTask = () -> {
            try {
                timingService.measure(taskId, task);
            } finally {
                // One-shot task done, remove future
                activeTasks.remove(taskId);
            }
        };

        // Atomic replacement of future
        activeTasks.compute(taskId, (k, existingFuture) -> {
            if (existingFuture != null && !existingFuture.isDone()) {
                existingFuture.cancel(false);
            }
            return executor.schedule(wrappedTask, delay, unit);
        });
    }

    @Override
    public void scheduleAtFixedRate(String taskId, long initialDelay, long period, TimeUnit unit) {
        Runnable task = getTaskOrThrow(taskId);

        // Wrap task with timing
        // Notes: scheduleAtFixedRate doesn't remove future until cancelled
        Runnable wrappedTask = () -> {
            try {
                timingService.measure(taskId, task);
            } catch (Exception e) {
                // Don't let exception kill the scheduler thread
                // Logger removed per user request, so we suppress or print stacktrace to
                // stderr?
                // "Async failures must be isolated and not crash scheduler core"
                // ScheduledExecutorService swallows exceptions and stops future.
                // We must catch-all to keep it running if that's desired,
                // BUT standard behavior is stop-on-execution-exception.
                // Let's let it fail the future but not crash the thread (executor handles
                // this).
                throw e;
            }
        };

        activeTasks.compute(taskId, (k, existingFuture) -> {
            if (existingFuture != null && !existingFuture.isDone()) {
                existingFuture.cancel(false);
            }
            return executor.scheduleAtFixedRate(wrappedTask, initialDelay, period, unit);
        });
    }

    @Override
    public boolean cancel(String taskId) {
        ScheduledFuture<?> future = activeTasks.remove(taskId);
        if (future != null) {
            future.cancel(false); // interrupt=false to let it finish if running
            return true;
        }
        return false;
    }

    private Runnable getTaskOrThrow(String taskId) {
        Runnable task = taskDefinitions.get(taskId);
        if (task == null) {
            throw new IllegalArgumentException("Task not found: " + taskId);
        }
        return task;
    }
}
