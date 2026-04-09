package com.natsu.common.model.message;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for the Message class.
 */
class MessageTest {

    @Test
    void shouldCreateSimpleMessage() {
        Message<String> message = Message.of("test-topic", "Hello");
        
        assertNotNull(message.getId());
        assertEquals("test-topic", message.getTopic());
        assertEquals("Hello", message.getPayload());
        assertNotNull(message.getTimestamp());
        assertEquals(0, message.getPriority());
        assertNull(message.getCorrelationId());
        assertNull(message.getReplyTo());
        assertNull(message.getTtlMillis());
    }

    @Test
    void shouldCreateMessageWithBuilder() {
        Message<String> message = Message.<String>builder()
                .id("msg-123")
                .topic("orders")
                .payload("Order data")
                .header("source", "api")
                .priority(5)
                .correlationId("corr-456")
                .replyTo("replies")
                .ttl(Duration.ofMinutes(5))
                .build();
        
        assertEquals("msg-123", message.getId());
        assertEquals("orders", message.getTopic());
        assertEquals("Order data", message.getPayload());
        assertEquals("api", message.getHeader("source"));
        assertEquals(5, message.getPriority());
        assertEquals("corr-456", message.getCorrelationId());
        assertEquals("replies", message.getReplyTo());
        assertEquals(300000L, message.getTtlMillis());
    }

    @Test
    void shouldRequireTopic() {
        assertThrows(IllegalArgumentException.class, () -> {
            Message.<String>builder()
                    .payload("test")
                    .build();
        });
    }

    @Test
    void shouldCheckExpiration() {
        // Not expired - no TTL
        Message<String> noTtl = Message.of("topic", "data");
        assertFalse(noTtl.isExpired());
        
        // Not expired - future TTL
        Message<String> future = Message.<String>builder()
                .topic("topic")
                .payload("data")
                .ttl(Duration.ofHours(1))
                .build();
        assertFalse(future.isExpired());
        
        // Expired - past TTL
        Message<String> expired = Message.<String>builder()
                .topic("topic")
                .payload("data")
                .timestamp(java.time.Instant.now().minusSeconds(60))
                .ttlMillis(1000L)
                .build();
        assertTrue(expired.isExpired());
    }

    @Test
    void shouldCreateReplyMessage() {
        Message<String> request = Message.<String>builder()
                .topic("requests")
                .payload("request data")
                .replyTo("replies")
                .build();
        
        Message<String> reply = request.reply("response data");
        
        assertEquals("replies", reply.getTopic());
        assertEquals("response data", reply.getPayload());
        assertEquals(request.getId(), reply.getCorrelationId());
    }

    @Test
    void shouldFailReplyWithoutReplyTo() {
        Message<String> message = Message.of("topic", "data");
        
        assertThrows(IllegalStateException.class, () -> message.reply("response"));
    }
}

/**
 * Tests for LocalMessageQueue.
 */
class LocalMessageQueueTest {

    private LocalMessageQueue queue;

    @BeforeEach
    void setUp() {
        queue = new LocalMessageQueue("test");
        queue.start();
    }

    @AfterEach
    void tearDown() {
        queue.close();
    }

    @Test
    void shouldPublishAndSubscribe() throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> received = new AtomicReference<>();
        
        queue.subscribe("test-topic", (Message<String> msg) -> {
            received.set(msg.getPayload());
            latch.countDown();
        });
        
        queue.publish("test-topic", "Hello World");
        
        assertTrue(latch.await(2, TimeUnit.SECONDS));
        assertEquals("Hello World", received.get());
    }

    @Test
    void shouldSendAndReceive() {
        queue.send("test-queue", "Message 1");
        queue.send("test-queue", "Message 2");
        
        Optional<Message<String>> msg1 = queue.receive("test-queue", Duration.ofSeconds(1));
        Optional<Message<String>> msg2 = queue.receive("test-queue", Duration.ofSeconds(1));
        Optional<Message<String>> msg3 = queue.receiveNoWait("test-queue");
        
        assertTrue(msg1.isPresent());
        assertEquals("Message 1", msg1.get().getPayload());
        
        assertTrue(msg2.isPresent());
        assertEquals("Message 2", msg2.get().getPayload());
        
        assertFalse(msg3.isPresent());
    }

    @Test
    void shouldReportQueueSize() {
        assertEquals(0, queue.getQueueSize("my-queue"));
        
        queue.send("my-queue", "msg1");
        queue.send("my-queue", "msg2");
        queue.send("my-queue", "msg3");
        
        assertEquals(3, queue.getQueueSize("my-queue"));
    }

    @Test
    void shouldPurgeQueue() {
        queue.send("queue", "msg1");
        queue.send("queue", "msg2");
        
        long purged = queue.purgeQueue("queue");
        
        assertEquals(2, purged);
        assertEquals(0, queue.getQueueSize("queue"));
    }

    @Test
    void shouldHandleMultipleSubscribers() throws Exception {
        CountDownLatch latch = new CountDownLatch(3);
        
        queue.subscribe("broadcast", msg -> latch.countDown());
        queue.subscribe("broadcast", msg -> latch.countDown());
        queue.subscribe("broadcast", msg -> latch.countDown());
        
        queue.publish("broadcast", "message");
        
        assertTrue(latch.await(2, TimeUnit.SECONDS));
    }

    @Test
    void shouldCancelSubscription() throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<Integer> count = new AtomicReference<>(0);
        
        var subscription = queue.subscribe("topic", msg -> {
            count.updateAndGet(v -> v + 1);
            latch.countDown();
        });
        
        queue.publish("topic", "msg1");
        assertTrue(latch.await(2, TimeUnit.SECONDS));
        
        subscription.cancel();
        
        queue.publish("topic", "msg2");
        Thread.sleep(100); // Wait a bit
        
        assertEquals(1, count.get());
    }

    @Test
    void shouldBeConnectedWhenRunning() {
        assertTrue(queue.isConnected());
        
        queue.stop();
        assertFalse(queue.isConnected());
    }

    @Test
    void shouldEnforceSizeLimit() {
        LocalMessageQueue limitedQueue = new LocalMessageQueue("limited", 2);
        limitedQueue.start();
        
        limitedQueue.send("queue", "msg1");
        limitedQueue.send("queue", "msg2");
        
        assertThrows(MessageException.class, () -> limitedQueue.send("queue", "msg3"));
        
        limitedQueue.close();
    }
}

/**
 * Tests for MessageSerializer.
 */
class MessageSerializerTest {

    @Test
    void shouldSerializeWithJson() {
        MessageSerializer serializer = MessageSerializer.json();
        
        TestPayload payload = new TestPayload("test", 42);
        byte[] data = serializer.serialize(payload);
        TestPayload result = serializer.deserialize(data, TestPayload.class);
        
        assertEquals("test", result.name);
        assertEquals(42, result.value);
        assertEquals("application/json", serializer.getContentType());
    }

    @Test
    void shouldSerializeWithString() {
        MessageSerializer serializer = MessageSerializer.string();
        
        String payload = "Hello World";
        byte[] data = serializer.serialize(payload);
        String result = serializer.deserialize(data, String.class);
        
        assertEquals("Hello World", result);
        assertEquals("text/plain", serializer.getContentType());
    }

    static class TestPayload {
        public String name;
        public int value;
        
        public TestPayload() {}
        
        public TestPayload(String name, int value) {
            this.name = name;
            this.value = value;
        }
    }
}

/**
 * Tests for MessageQueueFactory.
 */
class MessageQueueFactoryTest {

    @Test
    void shouldCreateLocalQueue() {
        MessageQueueFactory factory = MessageQueueFactory.getInstance();
        
        LocalMessageQueue queue = factory.createLocal("test-local");
        
        assertNotNull(queue);
        assertEquals("test-local", queue.getName());
        
        factory.close("test-local");
    }

    @Test
    void shouldGetExistingQueue() {
        MessageQueueFactory factory = MessageQueueFactory.getInstance();
        
        LocalMessageQueue queue1 = factory.createLocal("reuse-test");
        MessageQueue queue2 = factory.get("reuse-test");
        
        assertSame(queue1, queue2);
        
        factory.close("reuse-test");
    }

    @Test
    void shouldCreateFromConfig() {
        MessageQueueFactory factory = MessageQueueFactory.getInstance();
        
        MessageQueueConfig config = MessageQueueConfig.local()
                .name("config-test")
                .maxQueueSize(100)
                .build();
        
        MessageQueue queue = factory.create(config);
        
        assertNotNull(queue);
        assertTrue(queue instanceof LocalMessageQueue);
        
        factory.close("config-test");
    }
}

/**
 * Tests for MessageQueueStats.
 */
class MessageQueueStatsTest {

    @Test
    void shouldRecordStats() {
        MessageQueueStats stats = new MessageQueueStats("test");
        
        stats.recordPublish("topic1");
        stats.recordPublish("topic1");
        stats.recordSend("queue1");
        stats.recordReceive("topic1");
        stats.recordProcessed("topic1", 1_000_000); // 1ms
        stats.recordProcessed("topic1", 2_000_000); // 2ms
        stats.recordFailed("topic1");
        
        assertEquals(2, stats.getPublishedCount());
        assertEquals(1, stats.getSentCount());
        assertEquals(1, stats.getReceivedCount());
        assertEquals(2, stats.getProcessedCount());
        assertEquals(1, stats.getFailedCount());
        assertEquals(1.5, stats.getAverageLatencyMillis(), 0.01);
    }

    @Test
    void shouldTrackPerTopicStats() {
        MessageQueueStats stats = new MessageQueueStats("test");
        
        stats.recordPublish("topic-a");
        stats.recordPublish("topic-a");
        stats.recordPublish("topic-b");
        
        assertEquals(2, stats.getTopicStats("topic-a").getPublished());
        assertEquals(1, stats.getTopicStats("topic-b").getPublished());
    }

    @Test
    void shouldNotifyListeners() {
        MessageQueueStats stats = new MessageQueueStats("test");
        AtomicReference<MessageQueueStats.EventType> lastEvent = new AtomicReference<>();
        
        stats.addListener((type, topic, s) -> lastEvent.set(type));
        
        stats.recordPublish("topic");
        assertEquals(MessageQueueStats.EventType.PUBLISH, lastEvent.get());
        
        stats.recordFailed("topic");
        assertEquals(MessageQueueStats.EventType.FAILED, lastEvent.get());
    }

    @Test
    void shouldResetStats() {
        MessageQueueStats stats = new MessageQueueStats("test");
        
        stats.recordPublish("topic");
        stats.recordSend("queue");
        
        stats.reset();
        
        assertEquals(0, stats.getPublishedCount());
        assertEquals(0, stats.getSentCount());
    }
}
