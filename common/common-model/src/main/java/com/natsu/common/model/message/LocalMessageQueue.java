package com.natsu.common.model.message;

import java.time.Duration;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

/**
 * In-memory message queue implementation using blocking queues.
 * Suitable for single-process applications and testing.
 */
public class LocalMessageQueue extends AbstractMessageQueue {

    private final Map<String, BlockingQueue<Message<?>>> queues = new ConcurrentHashMap<>();
    private final int maxQueueSize;

    /**
     * Creates a local message queue with default settings.
     */
    public LocalMessageQueue() {
        this("local");
    }

    /**
     * Creates a local message queue with the given name.
     *
     * @param name the queue name
     */
    public LocalMessageQueue(String name) {
        this(name, Integer.MAX_VALUE);
    }

    /**
     * Creates a local message queue with size limit.
     *
     * @param name the queue name
     * @param maxQueueSize maximum messages per queue
     */
    public LocalMessageQueue(String name, int maxQueueSize) {
        super(name);
        this.maxQueueSize = maxQueueSize;
    }

    /**
     * Creates a local message queue with custom serializer.
     *
     * @param name the queue name
     * @param serializer the message serializer
     */
    public LocalMessageQueue(String name, MessageSerializer serializer) {
        super(name, serializer);
        this.maxQueueSize = Integer.MAX_VALUE;
    }

    @Override
    protected <T> void doPublish(Message<T> message) {
        // Publish to topic - deliver to all subscribers
        dispatchMessage(message.getTopic(), message);
    }

    @Override
    protected <T> void doSend(Message<T> message) {
        // Send to queue - point-to-point
        String queue = message.getTopic();
        BlockingQueue<Message<?>> q = getOrCreateQueue(queue);
        
        if (q.size() >= maxQueueSize) {
            throw new MessageException(queue, "Queue is full");
        }
        
        if (!q.offer(message)) {
            throw new MessageException(queue, "Failed to add message to queue");
        }
    }

    @Override
    @SuppressWarnings("unchecked")
    protected <T> Optional<Message<T>> doReceive(String queue, Duration timeout) {
        BlockingQueue<Message<?>> q = getOrCreateQueue(queue);
        
        try {
            Message<?> message;
            if (timeout.isZero()) {
                message = q.poll();
            } else {
                message = q.poll(timeout.toMillis(), TimeUnit.MILLISECONDS);
            }
            return Optional.ofNullable((Message<T>) message);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return Optional.empty();
        }
    }

    @Override
    protected void doSubscribe(String topic, SubscriptionImpl subscription) {
        // For local queue, subscriptions are handled by dispatchMessage
    }

    @Override
    protected void doStart() {
        // No startup needed for local queue
    }

    @Override
    protected void doStop() {
        // No shutdown needed for local queue
    }

    @Override
    protected void doClose() {
        queues.clear();
    }

    @Override
    public boolean isConnected() {
        return running.get();
    }

    @Override
    public void declareQueue(String queue, boolean durable) {
        getOrCreateQueue(queue);
    }

    @Override
    public long getQueueSize(String queue) {
        BlockingQueue<Message<?>> q = queues.get(queue);
        return q != null ? q.size() : 0;
    }

    @Override
    public long purgeQueue(String queue) {
        BlockingQueue<Message<?>> q = queues.get(queue);
        if (q != null) {
            int size = q.size();
            q.clear();
            return size;
        }
        return 0;
    }

    private BlockingQueue<Message<?>> getOrCreateQueue(String queue) {
        return queues.computeIfAbsent(queue, k -> new LinkedBlockingQueue<>(maxQueueSize));
    }
}
