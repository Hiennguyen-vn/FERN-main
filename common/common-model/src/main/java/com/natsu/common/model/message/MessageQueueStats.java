package com.natsu.common.model.message;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Provides statistics and monitoring for message queues.
 */
public class MessageQueueStats {

    private final String queueName;
    private final AtomicLong publishedCount = new AtomicLong();
    private final AtomicLong sentCount = new AtomicLong();
    private final AtomicLong receivedCount = new AtomicLong();
    private final AtomicLong processedCount = new AtomicLong();
    private final AtomicLong failedCount = new AtomicLong();
    private final AtomicLong totalLatencyNanos = new AtomicLong();
    
    private final Map<String, TopicStats> topicStats = new ConcurrentHashMap<>();
    private final List<StatsListener> listeners = new CopyOnWriteArrayList<>();

    public MessageQueueStats(String queueName) {
        this.queueName = queueName;
    }

    /**
     * Records a published message.
     *
     * @param topic the topic
     */
    public void recordPublish(String topic) {
        publishedCount.incrementAndGet();
        getTopicStats(topic).published.incrementAndGet();
        notifyListeners(EventType.PUBLISH, topic);
    }

    /**
     * Records a sent message (point-to-point).
     *
     * @param queue the queue
     */
    public void recordSend(String queue) {
        sentCount.incrementAndGet();
        getTopicStats(queue).sent.incrementAndGet();
        notifyListeners(EventType.SEND, queue);
    }

    /**
     * Records a received message.
     *
     * @param topic the topic/queue
     */
    public void recordReceive(String topic) {
        receivedCount.incrementAndGet();
        getTopicStats(topic).received.incrementAndGet();
        notifyListeners(EventType.RECEIVE, topic);
    }

    /**
     * Records a processed message with latency.
     *
     * @param topic the topic/queue
     * @param latencyNanos processing latency in nanoseconds
     */
    public void recordProcessed(String topic, long latencyNanos) {
        processedCount.incrementAndGet();
        totalLatencyNanos.addAndGet(latencyNanos);
        
        TopicStats stats = getTopicStats(topic);
        stats.processed.incrementAndGet();
        stats.totalLatencyNanos.addAndGet(latencyNanos);
        
        notifyListeners(EventType.PROCESSED, topic);
    }

    /**
     * Records a failed message processing.
     *
     * @param topic the topic/queue
     */
    public void recordFailed(String topic) {
        failedCount.incrementAndGet();
        getTopicStats(topic).failed.incrementAndGet();
        notifyListeners(EventType.FAILED, topic);
    }

    // Getters

    public String getQueueName() { return queueName; }
    public long getPublishedCount() { return publishedCount.get(); }
    public long getSentCount() { return sentCount.get(); }
    public long getReceivedCount() { return receivedCount.get(); }
    public long getProcessedCount() { return processedCount.get(); }
    public long getFailedCount() { return failedCount.get(); }

    /**
     * Gets the average latency in milliseconds.
     *
     * @return the average latency
     */
    public double getAverageLatencyMillis() {
        long processed = processedCount.get();
        if (processed == 0) return 0;
        return (totalLatencyNanos.get() / processed) / 1_000_000.0;
    }

    /**
     * Gets stats for a specific topic/queue.
     *
     * @param topic the topic
     * @return the stats
     */
    public TopicStats getTopicStats(String topic) {
        return topicStats.computeIfAbsent(topic, TopicStats::new);
    }

    /**
     * Gets all topic stats.
     *
     * @return map of topic to stats
     */
    public Map<String, TopicStats> getAllTopicStats() {
        return Map.copyOf(topicStats);
    }

    /**
     * Resets all statistics.
     */
    public void reset() {
        publishedCount.set(0);
        sentCount.set(0);
        receivedCount.set(0);
        processedCount.set(0);
        failedCount.set(0);
        totalLatencyNanos.set(0);
        topicStats.values().forEach(TopicStats::reset);
    }

    /**
     * Adds a stats listener.
     *
     * @param listener the listener
     */
    public void addListener(StatsListener listener) {
        listeners.add(listener);
    }

    /**
     * Removes a stats listener.
     *
     * @param listener the listener
     */
    public void removeListener(StatsListener listener) {
        listeners.remove(listener);
    }

    private void notifyListeners(EventType type, String topic) {
        for (StatsListener listener : listeners) {
            listener.onEvent(type, topic, this);
        }
    }

    /**
     * Creates a message handler that wraps another handler and records stats.
     *
     * @param topic the topic
     * @param handler the handler to wrap
     * @param <T> the payload type
     * @return the wrapped handler
     */
    public <T> MessageHandler<T> instrumentHandler(String topic, MessageHandler<T> handler) {
        return message -> {
            long start = System.nanoTime();
            try {
                handler.handle(message);
                recordProcessed(topic, System.nanoTime() - start);
            } catch (Exception e) {
                recordFailed(topic);
                throw e;
            }
        };
    }

    /**
     * Stats for a specific topic/queue.
     */
    public static class TopicStats {
        private final String topic;
        private final AtomicLong published = new AtomicLong();
        private final AtomicLong sent = new AtomicLong();
        private final AtomicLong received = new AtomicLong();
        private final AtomicLong processed = new AtomicLong();
        private final AtomicLong failed = new AtomicLong();
        private final AtomicLong totalLatencyNanos = new AtomicLong();

        TopicStats(String topic) {
            this.topic = topic;
        }

        public String getTopic() { return topic; }
        public long getPublished() { return published.get(); }
        public long getSent() { return sent.get(); }
        public long getReceived() { return received.get(); }
        public long getProcessed() { return processed.get(); }
        public long getFailed() { return failed.get(); }

        public double getAverageLatencyMillis() {
            long p = processed.get();
            if (p == 0) return 0;
            return (totalLatencyNanos.get() / p) / 1_000_000.0;
        }

        void reset() {
            published.set(0);
            sent.set(0);
            received.set(0);
            processed.set(0);
            failed.set(0);
            totalLatencyNanos.set(0);
        }
    }

    /**
     * Event types for stats notifications.
     */
    public enum EventType {
        PUBLISH, SEND, RECEIVE, PROCESSED, FAILED
    }

    /**
     * Listener for stats events.
     */
    @FunctionalInterface
    public interface StatsListener {
        void onEvent(EventType type, String topic, MessageQueueStats stats);
    }
}
