package com.natsu.common.model.message;

import java.util.concurrent.CompletableFuture;

/**
 * Interface for publishing messages to topics/queues.
 */
public interface MessagePublisher {

    /**
     * Publishes a message to its topic.
     *
     * @param message the message to publish
     * @param <T> the payload type
     */
    <T> void publish(Message<T> message);

    /**
     * Publishes a message to a specific topic.
     *
     * @param topic the topic name
     * @param payload the message payload
     * @param <T> the payload type
     */
    default <T> void publish(String topic, T payload) {
        publish(Message.of(topic, payload));
    }

    /**
     * Publishes a message asynchronously.
     *
     * @param message the message to publish
     * @param <T> the payload type
     * @return a future that completes when the message is published
     */
    default <T> CompletableFuture<Void> publishAsync(Message<T> message) {
        return CompletableFuture.runAsync(() -> publish(message));
    }

    /**
     * Publishes a message and waits for a reply.
     *
     * @param message the message to publish (should have replyTo set)
     * @param timeout the timeout for waiting
     * @param <T> the request payload type
     * @param <R> the reply payload type
     * @return the reply message
     */
    default <T, R> CompletableFuture<Message<R>> publishAndWaitForReply(
            Message<T> message, java.time.Duration timeout) {
        throw new UnsupportedOperationException("Request-reply not supported");
    }
}
