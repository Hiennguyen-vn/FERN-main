package com.natsu.common.model.message;

import com.natsu.common.utils.services.ServiceCategory;
import com.natsu.common.utils.services.ServiceDefinition;
import com.natsu.common.utils.services.ServicesRegistry;

import java.util.HashMap;
import java.util.Map;

/**
 * Configuration for message queue instances.
 * 
 * <p>
 * Implements {@link ServiceDefinition} for use with {@link ServicesRegistry}.
 */
public final class MessageQueueConfig implements ServiceDefinition {

    private final MessageQueueType type;
    private final String name;
    private final MessageSerializer serializer;

    // Local queue settings
    private final int maxQueueSize;

    // Socket settings
    private final String host;
    private final int port;
    private final boolean serverMode;

    // Redis settings
    private final Object redisClient;
    private final String redisKeyPrefix;

    // RabbitMQ settings
    private final Object rabbitClient;
    private final String exchangeName;
    private final boolean durableQueues;

    private MessageQueueConfig(Builder builder) {
        this.type = builder.type;
        this.name = builder.name;
        this.serializer = builder.serializer;
        this.maxQueueSize = builder.maxQueueSize;
        this.host = builder.host;
        this.port = builder.port;
        this.serverMode = builder.serverMode;
        this.redisClient = builder.redisClient;
        this.redisKeyPrefix = builder.redisKeyPrefix;
        this.rabbitClient = builder.rabbitClient;
        this.exchangeName = builder.exchangeName;
        this.durableQueues = builder.durableQueues;
    }

    public static Builder builder() {
        return new Builder();
    }

    public static Builder local() {
        return new Builder().type(MessageQueueType.LOCAL);
    }

    public static Builder socket() {
        return new Builder().type(MessageQueueType.SOCKET);
    }

    public static Builder redis() {
        return new Builder().type(MessageQueueType.REDIS);
    }

    public static Builder rabbitmq() {
        return new Builder().type(MessageQueueType.RABBITMQ);
    }

    // Getters

    public MessageQueueType getType() {
        return type;
    }

    public String getName() {
        return name;
    }

    @Override
    public ServiceCategory getServiceCategory() {
        return ServiceCategory.MESSAGE_QUEUE;
    }

    @Override
    public Map<String, Object> toMap() {
        Map<String, Object> map = new HashMap<>(ServiceDefinition.super.toMap());
        map.put("messageQueueType", type.name());
        map.put("host", host);
        map.put("port", port);
        return map;
    }

    public MessageSerializer getSerializer() {
        return serializer;
    }

    public int getMaxQueueSize() {
        return maxQueueSize;
    }

    public String getHost() {
        return host;
    }

    public int getPort() {
        return port;
    }

    public boolean isServerMode() {
        return serverMode;
    }

    public Object getRedisClient() {
        return redisClient;
    }

    public String getRedisKeyPrefix() {
        return redisKeyPrefix;
    }

    public Object getRabbitClient() {
        return rabbitClient;
    }

    public String getExchangeName() {
        return exchangeName;
    }

    public boolean isDurableQueues() {
        return durableQueues;
    }

    /**
     * Supported message queue types.
     */
    public enum MessageQueueType {
        LOCAL,
        SOCKET,
        REDIS,
        RABBITMQ
    }

    /**
     * Builder for MessageQueueConfig.
     */
    public static class Builder {
        private MessageQueueType type = MessageQueueType.LOCAL;
        private String name = "default";
        private MessageSerializer serializer = MessageSerializer.json();

        private int maxQueueSize = Integer.MAX_VALUE;

        private String host = "localhost";
        private int port = 5672;
        private boolean serverMode = false;

        private Object redisClient;
        private String redisKeyPrefix = "jefag:mq:";

        private Object rabbitClient;
        private String exchangeName = "jefag.exchange";
        private boolean durableQueues = true;

        private Builder() {
        }

        public Builder type(MessageQueueType type) {
            this.type = type;
            return this;
        }

        public Builder name(String name) {
            this.name = name;
            return this;
        }

        public Builder serializer(MessageSerializer serializer) {
            this.serializer = serializer;
            return this;
        }

        public Builder maxQueueSize(int maxQueueSize) {
            this.maxQueueSize = maxQueueSize;
            return this;
        }

        public Builder host(String host) {
            this.host = host;
            return this;
        }

        public Builder port(int port) {
            this.port = port;
            return this;
        }

        public Builder serverMode(boolean serverMode) {
            this.serverMode = serverMode;
            return this;
        }

        public Builder redisClient(RedisMessageQueue.RedisClientAdapter redisClient) {
            this.redisClient = redisClient;
            return this;
        }

        public Builder redisKeyPrefix(String prefix) {
            this.redisKeyPrefix = prefix;
            return this;
        }

        public Builder rabbitClient(RabbitMQMessageQueue.RabbitMQClientAdapter rabbitClient) {
            this.rabbitClient = rabbitClient;
            return this;
        }

        public Builder exchangeName(String exchangeName) {
            this.exchangeName = exchangeName;
            return this;
        }

        public Builder durableQueues(boolean durableQueues) {
            this.durableQueues = durableQueues;
            return this;
        }

        public MessageQueueConfig build() {
            return new MessageQueueConfig(this);
        }
    }
}
