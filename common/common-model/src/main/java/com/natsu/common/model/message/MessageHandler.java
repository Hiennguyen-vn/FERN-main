package com.natsu.common.model.message;

/**
 * Handler for processing received messages.
 *
 * @param <T> the payload type
 */
@FunctionalInterface
public interface MessageHandler<T> {

    /**
     * Handles a received message.
     *
     * @param message the message to handle
     * @throws Exception if handling fails
     */
    void handle(Message<T> message) throws Exception;

    /**
     * Called when message handling fails.
     * Default implementation logs and rethrows.
     *
     * @param message the message that failed
     * @param error the error that occurred
     */
    default void onError(Message<T> message, Throwable error) {
        System.err.println("Error handling message " + message.getId() + ": " + error.getMessage());
    }

    /**
     * Creates a handler that wraps this handler with error handling.
     *
     * @return a safe handler that catches exceptions
     */
    default MessageHandler<T> safe() {
        return message -> {
            try {
                handle(message);
            } catch (Exception e) {
                onError(message, e);
            }
        };
    }
}
