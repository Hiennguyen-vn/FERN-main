package com.natsu.common.model.message;

/**
 * Interface for request-reply messaging pattern.
 * Enables synchronous-style communication over async messaging.
 *
 * @param <Q> the request type
 * @param <R> the response type
 */
public interface RequestReply<Q, R> {

    /**
     * Sends a request and waits for a reply.
     *
     * @param request the request payload
     * @param timeout maximum time to wait for reply
     * @return the reply
     * @throws MessageException if request fails or times out
     */
    R request(Q request, java.time.Duration timeout);

    /**
     * Sends a request asynchronously.
     *
     * @param request the request payload
     * @param timeout maximum time to wait for reply
     * @return a future that completes with the reply
     */
    java.util.concurrent.CompletableFuture<R> requestAsync(Q request, java.time.Duration timeout);

    /**
     * Registers a handler for requests.
     *
     * @param handler function that processes requests and returns replies
     */
    void registerHandler(java.util.function.Function<Q, R> handler);

    /**
     * Creates a request-reply helper for a message queue.
     *
     * @param queue the message queue
     * @param requestTopic the topic for requests
     * @param replyTopic the topic for replies
     * @param requestType the request type class
     * @param replyType the reply type class
     * @param <Q> the request type
     * @param <R> the reply type
     * @return a request-reply instance
     */
    static <Q, R> RequestReply<Q, R> create(
            MessageQueue queue,
            String requestTopic,
            String replyTopic,
            Class<Q> requestType,
            Class<R> replyType) {
        return new DefaultRequestReply<>(queue, requestTopic, replyTopic, requestType, replyType);
    }
}

/**
 * Default implementation of request-reply pattern.
 */
class DefaultRequestReply<Q, R> implements RequestReply<Q, R> {

    private final MessageQueue queue;
    private final String requestTopic;
    private final String replyTopic;
    private final Class<Q> requestType;
    private final Class<R> replyType;
    
    private final java.util.concurrent.ConcurrentHashMap<String, java.util.concurrent.CompletableFuture<R>> 
            pendingRequests = new java.util.concurrent.ConcurrentHashMap<>();

    DefaultRequestReply(MessageQueue queue, String requestTopic, String replyTopic,
                       Class<Q> requestType, Class<R> replyType) {
        this.queue = queue;
        this.requestTopic = requestTopic;
        this.replyTopic = replyTopic;
        this.requestType = requestType;
        this.replyType = replyType;
        
        // Subscribe to reply topic
        queue.subscribe(replyTopic, replyType, this::handleReply);
    }

    @Override
    public R request(Q request, java.time.Duration timeout) {
        try {
            return requestAsync(request, timeout).get(timeout.toMillis(), 
                    java.util.concurrent.TimeUnit.MILLISECONDS);
        } catch (java.util.concurrent.TimeoutException e) {
            throw new MessageException("Request timed out", e);
        } catch (Exception e) {
            throw new MessageException("Request failed", e);
        }
    }

    @Override
    public java.util.concurrent.CompletableFuture<R> requestAsync(Q request, java.time.Duration timeout) {
        java.util.concurrent.CompletableFuture<R> future = new java.util.concurrent.CompletableFuture<>();
        
        Message<Q> message = Message.<Q>builder()
                .topic(requestTopic)
                .payload(request)
                .replyTo(replyTopic)
                .ttl(timeout)
                .build();
        
        pendingRequests.put(message.getId(), future);
        
        // Schedule timeout
        java.util.concurrent.CompletableFuture.delayedExecutor(
                timeout.toMillis(), java.util.concurrent.TimeUnit.MILLISECONDS)
                .execute(() -> {
                    java.util.concurrent.CompletableFuture<R> pending = pendingRequests.remove(message.getId());
                    if (pending != null && !pending.isDone()) {
                        pending.completeExceptionally(new MessageException("Request timed out"));
                    }
                });
        
        queue.publish(message);
        
        return future;
    }

    @Override
    public void registerHandler(java.util.function.Function<Q, R> handler) {
        queue.subscribe(requestTopic, requestType, message -> {
            try {
                R reply = handler.apply(message.getPayload());
                if (message.getReplyTo() != null) {
                    queue.publish(message.reply(reply));
                }
            } catch (Exception e) {
                // Could send error reply here
                throw e;
            }
        });
    }

    @SuppressWarnings("unchecked")
    private void handleReply(Message<R> reply) {
        String correlationId = reply.getCorrelationId();
        if (correlationId != null) {
            java.util.concurrent.CompletableFuture<R> future = pendingRequests.remove(correlationId);
            if (future != null) {
                future.complete(reply.getPayload());
            }
        }
    }
}
