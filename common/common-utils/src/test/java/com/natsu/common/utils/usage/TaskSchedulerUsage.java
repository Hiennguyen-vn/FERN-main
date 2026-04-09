package com.natsu.common.utils.usage;

import com.natsu.common.utils.services.scheduler.TaskScheduler;
import com.natsu.common.utils.services.scheduler.TaskSchedulerImpl;
import com.natsu.common.utils.services.timing.TimingService;
import com.natsu.common.utils.services.timing.TimingServiceImpl;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Usage example for {@link TaskScheduler}.
 * Demonstrates scheduling tasks.
 */
public final class TaskSchedulerUsage {

    public static void main(String[] args) throws InterruptedException {
        System.out.println("=== TaskScheduler Usage Example ===");

        // 1. Create Dependencies
        TimingService timingService = new TimingServiceImpl();

        // 2. Create Scheduler
        // TaskSchedulerImpl requires TimingService
        TaskSchedulerImpl schedulerImpl = new TaskSchedulerImpl(timingService);
        TaskScheduler scheduler = schedulerImpl;

        CountDownLatch latch = new CountDownLatch(3);

        // Define tasks
        Runnable oneOffTask = () -> {
            System.out.println("One-off task executed!");
            latch.countDown();
        };

        Runnable recurringTask = () -> {
            System.out.println("Recurring task executed at: " + System.currentTimeMillis());
            latch.countDown();
        };

        // 3. Register Tasks
        // Tasks must be registered with an ID before scheduling
        scheduler.register("task-one-off", oneOffTask);
        scheduler.register("task-recurring", recurringTask);

        // 4. Schedule a one-off task
        scheduler.schedule("task-one-off", 500, TimeUnit.MILLISECONDS);

        // 5. Schedule a fixed-rate task
        scheduler.scheduleAtFixedRate("task-recurring", 100, 300, TimeUnit.MILLISECONDS);

        // Wait for a bit to see tasks run
        latch.await(2, TimeUnit.SECONDS);

        // 6. Cancel a task
        scheduler.cancel("task-recurring");
        System.out.println("Cancelled recurring task.");

        // 7. Shutdown
        // TaskScheduler interface might not have shutdown, but implementation does
        schedulerImpl.shutdown();
        System.out.println("Scheduler shut down.");

        System.out.println("\n=== Done ===");
    }
}
