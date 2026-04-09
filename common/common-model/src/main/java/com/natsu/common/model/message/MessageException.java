package com.natsu.common.model.message;

/**
 * Exception thrown for messaging-related errors.
 */
public class MessageException extends RuntimeException {

    private final String queue;
    private final String messageId;

    public MessageException(String message) {
        super(message);
        this.queue = null;
        this.messageId = null;
    }

    public MessageException(String message, Throwable cause) {
        super(message, cause);
        this.queue = null;
        this.messageId = null;
    }

    public MessageException(String queue, String message) {
        super("[" + queue + "] " + message);
        this.queue = queue;
        this.messageId = null;
    }

    public MessageException(String queue, String message, Throwable cause) {
        super("[" + queue + "] " + message, cause);
        this.queue = queue;
        this.messageId = null;
    }

    public MessageException(String queue, String messageId, String message, Throwable cause) {
        super("[" + queue + "] msg=" + messageId + ": " + message, cause);
        this.queue = queue;
        this.messageId = messageId;
    }

    public String getQueue() {
        return queue;
    }

    public String getMessageId() {
        return messageId;
    }
}
