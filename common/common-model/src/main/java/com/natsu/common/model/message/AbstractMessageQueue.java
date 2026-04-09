package com.natsu.common.model.message;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Abstract base implementation for message queues.
 * Provides common functionality for all implementations.
 */
public abstract class AbstractMessageQueue implements MessageQueue {

    protected final String name;
    protected final MessageSerializer serializer;
    protected final Map<String, List<SubscriptionImpl>> subscriptions = new ConcurrentHashMap<>();
    protected final ExecutorService executor;
    protected final AtomicBoolean running = new AtomicBoolean(false);
    protected final Semaphore dispatchPermits;

    private static final int DEFAULT_MAX_CONCURRENT_HANDLERS = 256;

    protected AbstractMessageQueue(String name) {
        this(name, MessageSerializer.json());
    }

    protected AbstractMessageQueue(String name, MessageSerializer serializer) {
        this(name, serializer, new ThreadPoolExecutor(
                Runtime.getRuntime().availableProcessors(),
                Runtime.getRuntime().availableProcessors(),
                60L,
                TimeUnit.SECONDS,
                new ArrayBlockingQueue<>(8192),
                Executors.defaultThreadFactory(),
                new ThreadPoolExecutor.CallerRunsPolicy()
        ));
    }

    protected AbstractMessageQueue(String name, MessageSerializer serializer, ExecutorService executor) {
        this(name, serializer, executor, DEFAULT_MAX_CONCURRENT_HANDLERS);
    }

    protected AbstractMessageQueue(String name, MessageSerializer serializer, ExecutorService executor,
            int maxConcurrentHandlers) {
        this.name = name;
        this.serializer = serializer;
        this.executor = executor;
        this.dispatchPermits = new Semaphore(maxConcurrentHandlers);
    }

    @Override
    public String getName() {
        return name;
    }

    @Override
    public <T> void publish(Message<T> message) {
        checkRunning();
        doPublish(message);
    }

    @Override
    public <T> void send(Message<T> message) {
        checkRunning();
        doSend(message);
    }

    @Override
    public <T> Optional<Message<T>> receive(String queue, Duration timeout) {
        checkRunning();
        return doReceive(queue, timeout);
    }

    @Override
    @SuppressWarnings("unchecked")
    public <T> Subscription subscribe(String topic, MessageHandler<T> handler) {
        return subscribe(topic, (Class<T>) Object.class, handler);
    }

    @Override
    public <T> Subscription subscribe(String topic, Class<T> payloadType, MessageHandler<T> handler) {
        checkRunning();

        SubscriptionImpl subscription = new SubscriptionImpl(topic, payloadType, handler);
        subscriptions.computeIfAbsent(topic, k -> new CopyOnWriteArrayList<>()).add(subscription);

        doSubscribe(topic, subscription);

        return subscription;
    }

    @Override
    public void start() {
        if (running.compareAndSet(false, true)) {
            doStart();
        }
    }

    @Override
    public void stop() {
        if (running.compareAndSet(true, false)) {
            doStop();
        }
    }

    @Override
    public void close() {
        stop();
        subscriptions.clear();
        executor.shutdownNow();
        doClose();
    }

    protected void checkRunning() {
        if (!running.get()) {
            throw new MessageException("Message queue is not running");
        }
    }

    /**
     * Dispatches a message to all subscribers for the topic.
     *
     * @param topic   the topic
     * @param message the message
     */
    @SuppressWarnings({ "unchecked", "rawtypes" })
    protected void dispatchMessage(String topic, Message<?> message) {
        List<SubscriptionImpl> subs = subscriptions.get(topic);
        if (subs == null || subs.isEmpty()) {
            return;
        }

        for (SubscriptionImpl sub : subs) {
            if (!sub.isActive()) {
                continue;
            }
            executor.submit(() -> {
                try {
                    dispatchPermits.acquire();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return;
                }
                try {
                    ((MessageHandler) sub.handler).handle(message);
                } catch (Exception e) {
                    ((MessageHandler) sub.handler).onError((Message) message, e);
                } finally {
                    dispatchPermits.release();
                }
            });
        }
    }

    // Abstract methods to be implemented by subclasses

    protected abstract <T> void doPublish(Message<T> message);

    protected abstract <T> void doSend(Message<T> message);

    protected abstract <T> Optional<Message<T>> doReceive(String queue, Duration timeout);

    protected abstract void doSubscribe(String topic, SubscriptionImpl subscription);

    protected abstract void doStart();

    protected abstract void doStop();

    protected void doClose() {
        // Override if needed
    }

    /**
     * Internal subscription implementation.
     */
    protected class SubscriptionImpl implements Subscription {
        private final String topic;
        private final Class<?> payloadType;
        private final MessageHandler<?> handler;
        private volatile boolean active = true;

        public SubscriptionImpl(String topic, Class<?> payloadType, MessageHandler<?> handler) {
            this.topic = topic;
            this.payloadType = payloadType;
            this.handler = handler;
        }

        @Override
        public String getTopic() {
            return topic;
        }

        @Override
        public boolean isActive() {
            return active && running.get();
        }

        @Override
        public void cancel() {
            active = false;
            List<SubscriptionImpl> subs = subscriptions.get(topic);
            if (subs != null) {
                subs.remove(this);
            }
            doUnsubscribe(topic, this);
        }

        public Class<?> getPayloadType() {
            return payloadType;
        }

        public MessageHandler<?> getHandler() {
            return handler;
        }
    }

    protected void doUnsubscribe(String topic, SubscriptionImpl subscription) {
        // Override if needed
    }
}
