package com.natsu.common.model.message;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * Represents a message that can be sent through a message queue.
 *
 * @param <T> the payload type
 */
public final class Message<T> {

    private final String id;
    private final String topic;
    private final T payload;
    private final Map<String, String> headers;
    private final Instant timestamp;
    private final String correlationId;
    private final String replyTo;
    private final int priority;
    private final Long ttlMillis;

    private Message(Builder<T> builder) {
        this.id = builder.id != null ? builder.id : UUID.randomUUID().toString();
        this.topic = builder.topic;
        this.payload = builder.payload;
        this.headers = builder.headers != null ? Map.copyOf(builder.headers) : Map.of();
        this.timestamp = builder.timestamp != null ? builder.timestamp : Instant.now();
        this.correlationId = builder.correlationId;
        this.replyTo = builder.replyTo;
        this.priority = builder.priority;
        this.ttlMillis = builder.ttlMillis;
    }

    /**
     * Creates a simple message with just a topic and payload.
     *
     * @param topic the topic/queue name
     * @param payload the message payload
     * @param <T> the payload type
     * @return the message
     */
    public static <T> Message<T> of(String topic, T payload) {
        return Message.<T>builder()
                .topic(topic)
                .payload(payload)
                .build();
    }

    /**
     * Creates a new builder.
     *
     * @param <T> the payload type
     * @return a new builder
     */
    public static <T> Builder<T> builder() {
        return new Builder<>();
    }

    // Getters

    public String getId() {
        return id;
    }

    public String getTopic() {
        return topic;
    }

    public T getPayload() {
        return payload;
    }

    public Map<String, String> getHeaders() {
        return headers;
    }

    public String getHeader(String key) {
        return headers.get(key);
    }

    public Instant getTimestamp() {
        return timestamp;
    }

    public String getCorrelationId() {
        return correlationId;
    }

    public String getReplyTo() {
        return replyTo;
    }

    public int getPriority() {
        return priority;
    }

    public Long getTtlMillis() {
        return ttlMillis;
    }

    /**
     * Checks if the message has expired.
     *
     * @return true if expired
     */
    public boolean isExpired() {
        if (ttlMillis == null) {
            return false;
        }
        return Instant.now().isAfter(timestamp.plusMillis(ttlMillis));
    }

    /**
     * Creates a reply message to this message.
     *
     * @param payload the reply payload
     * @param <R> the reply payload type
     * @return the reply message
     */
    public <R> Message<R> reply(R payload) {
        if (replyTo == null) {
            throw new IllegalStateException("Message has no replyTo address");
        }
        return Message.<R>builder()
                .topic(replyTo)
                .payload(payload)
                .correlationId(id)
                .build();
    }

    @Override
    public String toString() {
        return "Message{" +
               "id='" + id + '\'' +
               ", topic='" + topic + '\'' +
               ", payload=" + payload +
               ", timestamp=" + timestamp +
               '}';
    }

    /**
     * Builder for creating messages.
     *
     * @param <T> the payload type
     */
    public static class Builder<T> {
        private String id;
        private String topic;
        private T payload;
        private java.util.Map<String, String> headers = new java.util.HashMap<>();
        private Instant timestamp;
        private String correlationId;
        private String replyTo;
        private int priority = 0;
        private Long ttlMillis;

        private Builder() {}

        public Builder<T> id(String id) {
            this.id = id;
            return this;
        }

        public Builder<T> topic(String topic) {
            this.topic = topic;
            return this;
        }

        public Builder<T> payload(T payload) {
            this.payload = payload;
            return this;
        }

        public Builder<T> header(String key, String value) {
            this.headers.put(key, value);
            return this;
        }

        public Builder<T> headers(Map<String, String> headers) {
            this.headers.putAll(headers);
            return this;
        }

        public Builder<T> timestamp(Instant timestamp) {
            this.timestamp = timestamp;
            return this;
        }

        public Builder<T> correlationId(String correlationId) {
            this.correlationId = correlationId;
            return this;
        }

        public Builder<T> replyTo(String replyTo) {
            this.replyTo = replyTo;
            return this;
        }

        public Builder<T> priority(int priority) {
            this.priority = priority;
            return this;
        }

        public Builder<T> ttl(java.time.Duration ttl) {
            this.ttlMillis = ttl != null ? ttl.toMillis() : null;
            return this;
        }

        public Builder<T> ttlMillis(Long ttlMillis) {
            this.ttlMillis = ttlMillis;
            return this;
        }

        public Message<T> build() {
            if (topic == null || topic.isEmpty()) {
                throw new IllegalArgumentException("Topic is required");
            }
            return new Message<>(this);
        }
    }
}
