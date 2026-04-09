package com.natsu.common.utils.services.timing;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.IntStream;

import static org.junit.jupiter.api.Assertions.*;

class TimingServiceImplTest {

    private TimingService timingService;

    @BeforeEach
    void setUp() {
        timingService = new TimingServiceImpl();
    }

    @Test
    void testStartAndStop() throws InterruptedException {
        String taskId = "test-task-1";
        timingService.start(taskId);
        Thread.sleep(10); // Simulate work
        long duration = timingService.stop(taskId);

        assertTrue(duration >= 0, "Duration should be non-negative");
    }

    @Test
    void testStopWithoutStart() {
        String taskId = "non-existent-task";
        long duration = timingService.stop(taskId);
        assertEquals(0, duration, "Stopping a non-existent task should return 0");
    }

    @Test
    void testDuplicateStartThrowsException() {
        String taskId = "duplicate-task";
        timingService.start(taskId);
        assertThrows(IllegalStateException.class, () -> timingService.start(taskId),
                "Starting an already active task should throw IllegalStateException");
    }

    @Test
    void testNestedTimers() {
        String parentTask = "parent-task";
        String childTask = "child-task";

        timingService.start(parentTask);
        try {
            Thread.sleep(5);
            timingService.start(childTask);
            Thread.sleep(5);
            long childDuration = timingService.stop(childTask);
            assertTrue(childDuration >= 0);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        long parentDuration = timingService.stop(parentTask);
        assertTrue(parentDuration >= 0);
        assertTrue(parentDuration >= 10, "Parent duration should include child duration");
    }

    @Test
    void testMeasureRunnable() {
        String taskId = "measure-runnable";
        timingService.measure(taskId, () -> {
            try {
                Thread.sleep(10);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        });
        // Verification is implicit: if no exception is thrown, it works.
        // We can't easily check the logged duration here without complex log capturing,
        // but we can verify the task is cleaned up.
        long durationAfter = timingService.stop(taskId);
        assertEquals(0, durationAfter, "Task should be cleaned up after measure()");
    }

    @Test
    void testMeasureSupplier() {
        String taskId = "measure-supplier";
        String result = timingService.measure(taskId, () -> {
            try {
                Thread.sleep(10);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            return "success";
        });

        assertEquals("success", result);
        long durationAfter = timingService.stop(taskId);
        assertEquals(0, durationAfter, "Task should be cleaned up after measure()");
    }

    @Test
    void testConcurrency() throws InterruptedException {
        int threadCount = 100;
        ExecutorService executor = Executors.newFixedThreadPool(10);
        CountDownLatch latch = new CountDownLatch(threadCount);
        AtomicInteger successCount = new AtomicInteger(0);

        IntStream.range(0, threadCount).forEach(i -> executor.submit(() -> {
            try {
                String taskId = "concurrent-task-" + i;
                timingService.start(taskId);
                Thread.sleep(5);
                long duration = timingService.stop(taskId);
                if (duration >= 0) {
                    successCount.incrementAndGet();
                }
            } catch (Exception e) {
                e.printStackTrace();
            } finally {
                latch.countDown();
            }
        }));

        boolean completed = latch.await(5, TimeUnit.SECONDS);
        assertTrue(completed, "All threads should complete within timeout");
        assertEquals(threadCount, successCount.get(), "All tasks should complete successfully");
        executor.shutdown();
    }
}
