package com.natsu.common.model.message;

import java.time.Duration;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ScheduledExecutorService;

/**
 * Redis-based message queue implementation.
 * Uses Redis pub/sub for topics and lists for queues.
 * 
 * Requires a RedisClient adapter to be provided.
 */
public class RedisMessageQueue extends AbstractMessageQueue {

    private final RedisClientAdapter redisClient;
    private final String keyPrefix;
    private final ScheduledExecutorService pollExecutor;
    private final ConcurrentHashMap<String, Future<?>> pollingTasks = new ConcurrentHashMap<>();

    /**
     * Interface for Redis client adapters (Jedis, Lettuce, etc.)
     */
    public interface RedisClientAdapter {
        /**
         * Checks if connected to Redis.
         */
        boolean isConnected();

        /**
         * Publishes a message to a pub/sub channel.
         *
         * @param channel the channel name
         * @param message the message data
         * @return number of subscribers that received the message
         */
        long publish(String channel, byte[] message);

        /**
         * Subscribes to pub/sub channels.
         *
         * @param handler callback for received messages
         * @param channels the channels to subscribe to
         */
        void subscribe(PubSubHandler handler, String... channels);

        /**
         * Unsubscribes from pub/sub channels.
         *
         * @param channels the channels to unsubscribe from
         */
        void unsubscribe(String... channels);

        /**
         * Pushes a message to the end of a list (queue).
         *
         * @param key the list key
         * @param value the value to push
         * @return the length of the list after push
         */
        long rpush(String key, byte[] value);

        /**
         * Pops a message from the front of a list (blocking).
         *
         * @param timeout timeout in seconds (0 = forever)
         * @param keys the list keys to pop from
         * @return [key, value] or null if timeout
         */
        byte[][] blpop(int timeout, String... keys);

        /**
         * Gets the length of a list.
         *
         * @param key the list key
         * @return the length
         */
        long llen(String key);

        /**
         * Deletes keys.
         *
         * @param keys the keys to delete
         * @return number of keys deleted
         */
        long del(String... keys);

        /**
         * Closes the connection.
         */
        void close();

        /**
         * Handler for pub/sub messages.
         */
        interface PubSubHandler {
            void onMessage(String channel, byte[] message);
            default void onSubscribe(String channel, int subscribedChannels) {}
            default void onUnsubscribe(String channel, int subscribedChannels) {}
        }
    }

    /**
     * Creates a Redis message queue.
     *
     * @param redisClient the Redis client adapter
     */
    public RedisMessageQueue(RedisClientAdapter redisClient) {
        this("redis", redisClient);
    }

    /**
     * Creates a Redis message queue with a name.
     *
     * @param name the queue name
     * @param redisClient the Redis client adapter
     */
    public RedisMessageQueue(String name, RedisClientAdapter redisClient) {
        this(name, redisClient, "jefag:mq:");
    }

    /**
     * Creates a Redis message queue with custom key prefix.
     *
     * @param name the queue name
     * @param redisClient the Redis client adapter
     * @param keyPrefix prefix for Redis keys
     */
    public RedisMessageQueue(String name, RedisClientAdapter redisClient, String keyPrefix) {
        super(name);
        this.redisClient = redisClient;
        this.keyPrefix = keyPrefix;
        this.pollExecutor = Executors.newScheduledThreadPool(4);
    }

    @Override
    protected <T> void doPublish(Message<T> message) {
        String channel = keyPrefix + "topic:" + message.getTopic();
        byte[] data = serializeMessage(message);
        redisClient.publish(channel, data);
    }

    @Override
    protected <T> void doSend(Message<T> message) {
        String queueKey = keyPrefix + "queue:" + message.getTopic();
        byte[] data = serializeMessage(message);
        redisClient.rpush(queueKey, data);
    }

    @Override
    @SuppressWarnings("unchecked")
    protected <T> Optional<Message<T>> doReceive(String queue, Duration timeout) {
        String queueKey = keyPrefix + "queue:" + queue;
        int timeoutSecs = (int) Math.max(1, timeout.toSeconds());
        
        byte[][] result = redisClient.blpop(timeoutSecs, queueKey);
        if (result == null || result.length < 2) {
            return Optional.empty();
        }
        
        Message<?> message = deserializeMessage(result[1]);
        return Optional.of((Message<T>) message);
    }

    @Override
    protected void doSubscribe(String topic, SubscriptionImpl subscription) {
        String channel = keyPrefix + "topic:" + topic;
        
        // Start polling for pub/sub messages
        if (!pollingTasks.containsKey(channel)) {
            redisClient.subscribe(new RedisClientAdapter.PubSubHandler() {
                @Override
                public void onMessage(String ch, byte[] data) {
                    Message<?> message = deserializeMessage(data);
                    dispatchMessage(topic, message);
                }
            }, channel);
        }
    }

    @Override
    protected void doUnsubscribe(String topic, SubscriptionImpl subscription) {
        // Only unsubscribe if no more subscriptions for this topic
        if (!subscriptions.containsKey(topic) || subscriptions.get(topic).isEmpty()) {
            String channel = keyPrefix + "topic:" + topic;
            redisClient.unsubscribe(channel);
        }
    }

    @Override
    protected void doStart() {
        if (!redisClient.isConnected()) {
            throw new MessageException("Redis client is not connected");
        }
    }

    @Override
    protected void doStop() {
        pollingTasks.values().forEach(f -> f.cancel(true));
        pollingTasks.clear();
    }

    @Override
    protected void doClose() {
        pollExecutor.shutdownNow();
        redisClient.close();
    }

    @Override
    public boolean isConnected() {
        return running.get() && redisClient.isConnected();
    }

    @Override
    public long getQueueSize(String queue) {
        String queueKey = keyPrefix + "queue:" + queue;
        return redisClient.llen(queueKey);
    }

    @Override
    public long purgeQueue(String queue) {
        String queueKey = keyPrefix + "queue:" + queue;
        long size = redisClient.llen(queueKey);
        redisClient.del(queueKey);
        return size;
    }

    private <T> byte[] serializeMessage(Message<T> message) {
        try (var baos = new java.io.ByteArrayOutputStream();
             var oos = new java.io.ObjectOutputStream(baos)) {
            // Serialize message metadata
            oos.writeUTF(message.getId());
            oos.writeUTF(message.getTopic());
            oos.writeLong(message.getTimestamp().toEpochMilli());
            oos.writeInt(message.getPriority());
            oos.writeObject(message.getCorrelationId());
            oos.writeObject(message.getReplyTo());
            oos.writeObject(message.getTtlMillis());
            oos.writeObject(message.getHeaders());
            
            // Serialize payload
            byte[] payloadBytes = serializer.serialize(message.getPayload());
            String payloadType = message.getPayload() != null ? 
                    message.getPayload().getClass().getName() : null;
            oos.writeObject(payloadType);
            oos.writeInt(payloadBytes != null ? payloadBytes.length : -1);
            if (payloadBytes != null) {
                oos.write(payloadBytes);
            }
            
            return baos.toByteArray();
        } catch (Exception e) {
            throw new MessageException("Failed to serialize message", e);
        }
    }

    @SuppressWarnings("unchecked")
    private Message<?> deserializeMessage(byte[] data) {
        try (var bais = new java.io.ByteArrayInputStream(data);
             var ois = new java.io.ObjectInputStream(bais)) {
            
            String id = ois.readUTF();
            String topic = ois.readUTF();
            long timestamp = ois.readLong();
            int priority = ois.readInt();
            String correlationId = (String) ois.readObject();
            String replyTo = (String) ois.readObject();
            Long ttlMillis = (Long) ois.readObject();
            java.util.Map<String, String> headers = (java.util.Map<String, String>) ois.readObject();
            
            String payloadType = (String) ois.readObject();
            int payloadLength = ois.readInt();
            Object payload = null;
            
            if (payloadLength >= 0) {
                byte[] payloadBytes = new byte[payloadLength];
                ois.readFully(payloadBytes);
                if (payloadType != null) {
                    try {
                        Class<?> type = Class.forName(payloadType);
                        payload = serializer.deserialize(payloadBytes, type);
                    } catch (ClassNotFoundException e) {
                        payload = payloadBytes;
                    }
                }
            }
            
            return Message.<Object>builder()
                    .id(id)
                    .topic(topic)
                    .timestamp(java.time.Instant.ofEpochMilli(timestamp))
                    .priority(priority)
                    .correlationId(correlationId)
                    .replyTo(replyTo)
                    .ttlMillis(ttlMillis)
                    .headers(headers)
                    .payload(payload)
                    .build();
            
        } catch (Exception e) {
            throw new MessageException("Failed to deserialize message", e);
        }
    }
}
