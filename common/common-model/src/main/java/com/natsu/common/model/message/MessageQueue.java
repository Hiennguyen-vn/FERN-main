package com.natsu.common.model.message;

import java.time.Duration;
import java.util.Optional;

/**
 * Interface for a message queue that supports both publish/subscribe and point-to-point messaging.
 */
public interface MessageQueue extends MessagePublisher, MessageSubscriber, AutoCloseable {

    /**
     * Gets the queue/broker name.
     *
     * @return the name
     */
    String getName();

    /**
     * Sends a message to a queue (point-to-point).
     * Unlike publish, send ensures only one consumer receives the message.
     *
     * @param message the message to send
     * @param <T> the payload type
     */
    <T> void send(Message<T> message);

    /**
     * Sends a message to a specific queue.
     *
     * @param queue the queue name
     * @param payload the message payload
     * @param <T> the payload type
     */
    default <T> void send(String queue, T payload) {
        send(Message.of(queue, payload));
    }

    /**
     * Receives a message from a queue (blocking).
     *
     * @param queue the queue name
     * @param timeout the maximum time to wait
     * @param <T> the payload type
     * @return the received message, or empty if timeout
     */
    <T> Optional<Message<T>> receive(String queue, Duration timeout);

    /**
     * Receives a message from a queue (non-blocking).
     *
     * @param queue the queue name
     * @param <T> the payload type
     * @return the received message, or empty if none available
     */
    default <T> Optional<Message<T>> receiveNoWait(String queue) {
        return receive(queue, Duration.ZERO);
    }

    /**
     * Acknowledges a message was processed successfully.
     *
     * @param message the message to acknowledge
     */
    default void acknowledge(Message<?> message) {
        // Default no-op for simple implementations
    }

    /**
     * Rejects a message, optionally requeueing it.
     *
     * @param message the message to reject
     * @param requeue whether to requeue the message
     */
    default void reject(Message<?> message, boolean requeue) {
        // Default no-op for simple implementations
    }

    /**
     * Creates a queue if it doesn't exist.
     *
     * @param queue the queue name
     * @param durable whether the queue survives restarts
     */
    default void declareQueue(String queue, boolean durable) {
        // Default no-op
    }

    /**
     * Creates a topic/exchange if it doesn't exist.
     *
     * @param topic the topic name
     */
    default void declareTopic(String topic) {
        // Default no-op
    }

    /**
     * Binds a queue to a topic with a routing key.
     *
     * @param queue the queue name
     * @param topic the topic/exchange name
     * @param routingKey the routing key pattern
     */
    default void bindQueue(String queue, String topic, String routingKey) {
        // Default no-op
    }

    /**
     * Gets the number of messages in a queue.
     *
     * @param queue the queue name
     * @return the message count
     */
    default long getQueueSize(String queue) {
        return -1; // Unknown
    }

    /**
     * Purges all messages from a queue.
     *
     * @param queue the queue name
     * @return the number of messages purged
     */
    default long purgeQueue(String queue) {
        return 0;
    }

    /**
     * Checks if the message queue is connected and healthy.
     *
     * @return true if healthy
     */
    boolean isConnected();

    /**
     * Starts the message queue (begins consuming).
     */
    void start();

    /**
     * Stops the message queue (stops consuming).
     */
    void stop();

    @Override
    void close();
}
