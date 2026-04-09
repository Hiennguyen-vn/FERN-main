package com.natsu.common.model.message;

import com.natsu.common.utils.services.ServiceCategory;
import com.natsu.common.utils.services.ServicesRegistry;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Factory for creating and managing message queue instances.
 * 
 * <p>
 * Supports loading configurations from {@link ServicesRegistry}.
 */
public final class MessageQueueFactory {

    private static final MessageQueueFactory INSTANCE = new MessageQueueFactory();

    private final Map<String, MessageQueue> queues = new ConcurrentHashMap<>();

    private MessageQueueFactory() {
    }

    /**
     * Gets the singleton factory instance.
     *
     * @return the factory
     */
    public static MessageQueueFactory getInstance() {
        return INSTANCE;
    }

    /**
     * Creates a message queue based on the configuration.
     *
     * @param config the configuration
     * @return the message queue
     */
    public MessageQueue create(MessageQueueConfig config) {
        MessageQueue queue = switch (config.getType()) {
            case LOCAL -> createLocalQueue(config);
            case SOCKET -> createSocketQueue(config);
            case REDIS -> createRedisQueue(config);
            case RABBITMQ -> createRabbitMQQueue(config);
        };

        queues.put(config.getName(), queue);
        return queue;
    }

    /**
     * Creates a simple local message queue.
     *
     * @return a local message queue
     */
    public LocalMessageQueue createLocal() {
        return createLocal("local");
    }

    /**
     * Creates a local message queue with a name.
     *
     * @param name the queue name
     * @return a local message queue
     */
    public LocalMessageQueue createLocal(String name) {
        LocalMessageQueue queue = new LocalMessageQueue(name);
        queues.put(name, queue);
        return queue;
    }

    /**
     * Creates a socket server message queue.
     *
     * @param port the port to listen on
     * @return a socket message queue in server mode
     */
    public SocketMessageQueue createSocketServer(int port) {
        SocketMessageQueue queue = SocketMessageQueue.server(port);
        queues.put("socket-server-" + port, queue);
        return queue;
    }

    /**
     * Creates a socket client message queue.
     *
     * @param host the server host
     * @param port the server port
     * @return a socket message queue in client mode
     */
    public SocketMessageQueue createSocketClient(String host, int port) {
        SocketMessageQueue queue = SocketMessageQueue.client(host, port);
        queues.put("socket-client-" + host + ":" + port, queue);
        return queue;
    }

    /**
     * Creates a Redis message queue.
     *
     * @param redisClient the Redis client adapter
     * @return a Redis message queue
     */
    public RedisMessageQueue createRedis(RedisMessageQueue.RedisClientAdapter redisClient) {
        RedisMessageQueue queue = new RedisMessageQueue(redisClient);
        queues.put("redis", queue);
        return queue;
    }

    /**
     * Creates a RabbitMQ message queue.
     *
     * @param rabbitClient the RabbitMQ client adapter
     * @return a RabbitMQ message queue
     */
    public RabbitMQMessageQueue createRabbitMQ(RabbitMQMessageQueue.RabbitMQClientAdapter rabbitClient) {
        RabbitMQMessageQueue queue = new RabbitMQMessageQueue(rabbitClient);
        queues.put("rabbitmq", queue);
        return queue;
    }

    /**
     * Gets a previously created queue by name.
     *
     * @param name the queue name
     * @return the queue, or null if not found
     */
    public MessageQueue get(String name) {
        return queues.get(name);
    }

    /**
     * Gets a queue or creates it if it doesn't exist.
     *
     * @param name   the queue name
     * @param config the configuration to use if creating
     * @return the queue
     */
    public MessageQueue getOrCreate(String name, MessageQueueConfig config) {
        return queues.computeIfAbsent(name, k -> create(config));
    }

    /**
     * Closes and removes a queue.
     *
     * @param name the queue name
     */
    public void close(String name) {
        MessageQueue queue = queues.remove(name);
        if (queue != null) {
            queue.close();
        }
    }

    /**
     * Closes all queues.
     */
    public void closeAll() {
        queues.values().forEach(MessageQueue::close);
        queues.clear();
    }

    private LocalMessageQueue createLocalQueue(MessageQueueConfig config) {
        return new LocalMessageQueue(config.getName(), config.getMaxQueueSize());
    }

    private SocketMessageQueue createSocketQueue(MessageQueueConfig config) {
        if (config.isServerMode()) {
            return SocketMessageQueue.server(config.getPort());
        } else {
            return SocketMessageQueue.client(config.getHost(), config.getPort());
        }
    }

    private RedisMessageQueue createRedisQueue(MessageQueueConfig config) {
        if (config.getRedisClient() == null) {
            throw new MessageException("Redis client adapter is required");
        }
        return new RedisMessageQueue(
                config.getName(),
                (RedisMessageQueue.RedisClientAdapter) config.getRedisClient(),
                config.getRedisKeyPrefix());
    }

    private RabbitMQMessageQueue createRabbitMQQueue(MessageQueueConfig config) {
        if (config.getRabbitClient() == null) {
            throw new MessageException("RabbitMQ client adapter is required");
        }
        return new RabbitMQMessageQueue(
                config.getName(),
                (RabbitMQMessageQueue.RabbitMQClientAdapter) config.getRabbitClient(),
                config.getExchangeName(),
                config.isDurableQueues());
    }

    // ==================== ServicesRegistry Integration ====================

    /**
     * Creates a message queue from a configuration registered in ServicesRegistry.
     *
     * @param name the configuration name in the registry
     * @return the message queue instance
     */
    public MessageQueue createFromRegistry(String name) {
        MessageQueueConfig config = ServicesRegistry.getConfig(name, ServiceCategory.MESSAGE_QUEUE);
        return create(config);
    }

    /**
     * Gets a message queue, creating it from registry if not already created.
     *
     * @param name the queue/config name
     * @return the message queue instance
     */
    public MessageQueue getOrCreateFromRegistry(String name) {
        MessageQueue existing = queues.get(name);
        if (existing != null) {
            return existing;
        }
        return createFromRegistry(name);
    }

    /**
     * Creates all message queues from configurations registered in
     * ServicesRegistry.
     * Only creates queues that don't require external clients (LOCAL, SOCKET).
     */
    public void createAllFromRegistry() {
        for (MessageQueueConfig config : ServicesRegistry
                .<MessageQueueConfig>getAllConfigs(ServiceCategory.MESSAGE_QUEUE)) {
            MessageQueueConfig.MessageQueueType type = config.getType();
            // Only auto-create queues that don't need external clients
            if (type == MessageQueueConfig.MessageQueueType.LOCAL ||
                    type == MessageQueueConfig.MessageQueueType.SOCKET) {
                create(config);
            }
        }
    }
}
