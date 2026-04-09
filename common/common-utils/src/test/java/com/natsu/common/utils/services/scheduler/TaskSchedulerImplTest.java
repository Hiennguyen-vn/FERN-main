package com.natsu.common.utils.services.scheduler;

import com.natsu.common.utils.services.timing.TimingService;
import com.natsu.common.utils.services.timing.TimingServiceImpl;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

class TaskSchedulerImplTest {

    private TimingService timingService;
    private TaskSchedulerImpl scheduler;

    @BeforeEach
    void setUp() {
        timingService = new TimingServiceImpl();
        scheduler = new TaskSchedulerImpl(timingService);
    }

    @AfterEach
    void tearDown() {
        scheduler.shutdown();
    }

    @Test
    void testRegisterAndRunSync() {
        String taskId = "sync-task";
        AtomicBoolean ran = new AtomicBoolean(false);

        scheduler.register(taskId, () -> ran.set(true));
        scheduler.run(taskId);

        assertTrue(ran.get(), "Task should have run synchronously");
    }

    @Test
    void testRunAsync() throws ExecutionException, InterruptedException {
        String taskId = "async-task";
        CountDownLatch latch = new CountDownLatch(1);

        scheduler.register(taskId, latch::countDown);
        CompletableFuture<Void> future = scheduler.runAsync(taskId);

        future.get(); // Wait for completion
        assertTrue(latch.await(1, TimeUnit.SECONDS), "Async task should complete");
    }

    @Test
    void testScheduleDelayed() throws InterruptedException {
        String taskId = "delayed-task";
        CountDownLatch latch = new CountDownLatch(1);

        scheduler.register(taskId, latch::countDown);
        scheduler.schedule(taskId, 50, TimeUnit.MILLISECONDS);

        assertFalse(latch.await(10, TimeUnit.MILLISECONDS), "Task should not run immediately");
        assertTrue(latch.await(100, TimeUnit.MILLISECONDS), "Task should run after delay");
    }

    @Test
    void testScheduleAtFixedRate() throws InterruptedException {
        String taskId = "periodic-task";
        AtomicInteger counter = new AtomicInteger(0);
        CountDownLatch latch = new CountDownLatch(3);

        scheduler.register(taskId, () -> {
            counter.incrementAndGet();
            latch.countDown();
        });

        // initial delay 0, period 10ms
        scheduler.scheduleAtFixedRate(taskId, 0, 10, TimeUnit.MILLISECONDS);

        assertTrue(latch.await(100, TimeUnit.MILLISECONDS), "Should run 3 times quickly");
        assertTrue(counter.get() >= 3, "Counter should be at least 3");

        scheduler.cancel(taskId);
    }

    @Test
    void testDuplicateRegistration() {
        String taskId = "dup-task";
        scheduler.register(taskId, () -> {
        });
        assertThrows(IllegalStateException.class, () -> scheduler.register(taskId, () -> {
        }),
                "Duplicate registration should throw exception");
    }

    @Test
    void testUnregister() {
        String taskId = "unregister-task";
        scheduler.register(taskId, () -> {
        });
        scheduler.unregister(taskId);

        assertThrows(IllegalArgumentException.class, () -> scheduler.run(taskId),
                "Running unregistered task should throw exception");
    }
}
