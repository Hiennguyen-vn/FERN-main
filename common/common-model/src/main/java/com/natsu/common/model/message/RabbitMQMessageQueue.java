package com.natsu.common.model.message;

import java.time.Duration;
import java.util.Optional;

/**
 * RabbitMQ-based message queue implementation.
 * Uses AMQP protocol for reliable messaging with acknowledgments.
 * 
 * Requires a RabbitMQ client adapter to be provided.
 */
public class RabbitMQMessageQueue extends AbstractMessageQueue {

    private final RabbitMQClientAdapter rabbitClient;
    private final String exchangeName;
    private final boolean durableQueues;

    /**
     * Interface for RabbitMQ client adapters.
     */
    public interface RabbitMQClientAdapter {
        /**
         * Checks if connected to RabbitMQ.
         */
        boolean isConnected();

        /**
         * Declares an exchange.
         *
         * @param exchange the exchange name
         * @param type the exchange type (direct, fanout, topic, headers)
         * @param durable whether the exchange survives restart
         */
        void declareExchange(String exchange, String type, boolean durable);

        /**
         * Declares a queue.
         *
         * @param queue the queue name
         * @param durable whether the queue survives restart
         * @param exclusive whether the queue is exclusive to this connection
         * @param autoDelete whether the queue is deleted when no longer used
         */
        void declareQueue(String queue, boolean durable, boolean exclusive, boolean autoDelete);

        /**
         * Binds a queue to an exchange.
         *
         * @param queue the queue name
         * @param exchange the exchange name
         * @param routingKey the routing key
         */
        void bindQueue(String queue, String exchange, String routingKey);

        /**
         * Publishes a message to an exchange.
         *
         * @param exchange the exchange name
         * @param routingKey the routing key
         * @param properties message properties
         * @param body the message body
         */
        void basicPublish(String exchange, String routingKey, MessageProperties properties, byte[] body);

        /**
         * Consumes messages from a queue.
         *
         * @param queue the queue name
         * @param autoAck whether to auto-acknowledge
         * @param consumer the consumer callback
         * @return the consumer tag
         */
        String basicConsume(String queue, boolean autoAck, Consumer consumer);

        /**
         * Cancels a consumer.
         *
         * @param consumerTag the consumer tag to cancel
         */
        void basicCancel(String consumerTag);

        /**
         * Acknowledges a message.
         *
         * @param deliveryTag the delivery tag
         * @param multiple whether to ack all messages up to this one
         */
        void basicAck(long deliveryTag, boolean multiple);

        /**
         * Rejects a message.
         *
         * @param deliveryTag the delivery tag
         * @param requeue whether to requeue the message
         */
        void basicReject(long deliveryTag, boolean requeue);

        /**
         * Gets a message from a queue (non-blocking).
         *
         * @param queue the queue name
         * @param autoAck whether to auto-acknowledge
         * @return the message or null
         */
        GetResponse basicGet(String queue, boolean autoAck);

        /**
         * Gets the message count in a queue.
         *
         * @param queue the queue name
         * @return the message count
         */
        long getMessageCount(String queue);

        /**
         * Purges all messages from a queue.
         *
         * @param queue the queue name
         * @return the number of messages purged
         */
        long purgeQueue(String queue);

        /**
         * Closes the connection.
         */
        void close();

        /**
         * Message properties.
         */
        interface MessageProperties {
            static MessageProperties create() {
                return new BasicMessageProperties();
            }

            MessageProperties contentType(String contentType);
            MessageProperties correlationId(String correlationId);
            MessageProperties replyTo(String replyTo);
            MessageProperties messageId(String messageId);
            MessageProperties priority(int priority);
            MessageProperties expiration(String expiration);
            MessageProperties timestamp(java.util.Date timestamp);
            MessageProperties headers(java.util.Map<String, Object> headers);

            String getContentType();
            String getCorrelationId();
            String getReplyTo();
            String getMessageId();
            Integer getPriority();
            String getExpiration();
            java.util.Date getTimestamp();
            java.util.Map<String, Object> getHeaders();
        }

        /**
         * Consumer callback interface.
         */
        interface Consumer {
            void handleDelivery(String consumerTag, long deliveryTag, String routingKey,
                              MessageProperties properties, byte[] body);
            default void handleCancel(String consumerTag) {}
        }

        /**
         * Response from basicGet.
         */
        interface GetResponse {
            long getDeliveryTag();
            String getRoutingKey();
            MessageProperties getProperties();
            byte[] getBody();
            int getMessageCount();
        }

        /**
         * Basic implementation of MessageProperties.
         */
        class BasicMessageProperties implements MessageProperties {
            private String contentType;
            private String correlationId;
            private String replyTo;
            private String messageId;
            private Integer priority;
            private String expiration;
            private java.util.Date timestamp;
            private java.util.Map<String, Object> headers = new java.util.HashMap<>();

            @Override
            public MessageProperties contentType(String contentType) {
                this.contentType = contentType;
                return this;
            }

            @Override
            public MessageProperties correlationId(String correlationId) {
                this.correlationId = correlationId;
                return this;
            }

            @Override
            public MessageProperties replyTo(String replyTo) {
                this.replyTo = replyTo;
                return this;
            }

            @Override
            public MessageProperties messageId(String messageId) {
                this.messageId = messageId;
                return this;
            }

            @Override
            public MessageProperties priority(int priority) {
                this.priority = priority;
                return this;
            }

            @Override
            public MessageProperties expiration(String expiration) {
                this.expiration = expiration;
                return this;
            }

            @Override
            public MessageProperties timestamp(java.util.Date timestamp) {
                this.timestamp = timestamp;
                return this;
            }

            @Override
            public MessageProperties headers(java.util.Map<String, Object> headers) {
                this.headers.putAll(headers);
                return this;
            }

            @Override public String getContentType() { return contentType; }
            @Override public String getCorrelationId() { return correlationId; }
            @Override public String getReplyTo() { return replyTo; }
            @Override public String getMessageId() { return messageId; }
            @Override public Integer getPriority() { return priority; }
            @Override public String getExpiration() { return expiration; }
            @Override public java.util.Date getTimestamp() { return timestamp; }
            @Override public java.util.Map<String, Object> getHeaders() { return headers; }
        }
    }

    /**
     * Creates a RabbitMQ message queue with default settings.
     *
     * @param rabbitClient the RabbitMQ client adapter
     */
    public RabbitMQMessageQueue(RabbitMQClientAdapter rabbitClient) {
        this("rabbitmq", rabbitClient);
    }

    /**
     * Creates a RabbitMQ message queue with a name.
     *
     * @param name the queue name
     * @param rabbitClient the RabbitMQ client adapter
     */
    public RabbitMQMessageQueue(String name, RabbitMQClientAdapter rabbitClient) {
        this(name, rabbitClient, "jefag.exchange", true);
    }

    /**
     * Creates a RabbitMQ message queue with custom settings.
     *
     * @param name the queue name
     * @param rabbitClient the RabbitMQ client adapter
     * @param exchangeName the exchange name
     * @param durableQueues whether queues should be durable
     */
    public RabbitMQMessageQueue(String name, RabbitMQClientAdapter rabbitClient, 
                                 String exchangeName, boolean durableQueues) {
        super(name);
        this.rabbitClient = rabbitClient;
        this.exchangeName = exchangeName;
        this.durableQueues = durableQueues;
    }

    @Override
    protected <T> void doPublish(Message<T> message) {
        String routingKey = message.getTopic();
        byte[] body = serializer.serialize(message.getPayload());
        
        var props = buildProperties(message);
        rabbitClient.basicPublish(exchangeName, routingKey, props, body);
    }

    @Override
    protected <T> void doSend(Message<T> message) {
        // For point-to-point, publish directly to default exchange with queue name as routing key
        String queue = message.getTopic();
        byte[] body = serializer.serialize(message.getPayload());
        
        var props = buildProperties(message);
        rabbitClient.basicPublish("", queue, props, body);
    }

    @Override
    @SuppressWarnings("unchecked")
    protected <T> Optional<Message<T>> doReceive(String queue, Duration timeout) {
        var response = rabbitClient.basicGet(queue, false);
        if (response == null) {
            if (!timeout.isZero()) {
                // Poll with timeout
                long endTime = System.currentTimeMillis() + timeout.toMillis();
                while (System.currentTimeMillis() < endTime) {
                    response = rabbitClient.basicGet(queue, false);
                    if (response != null) {
                        break;
                    }
                    try {
                        Thread.sleep(100);
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                        return Optional.empty();
                    }
                }
            }
        }
        
        if (response == null) {
            return Optional.empty();
        }
        
        Message<T> message = fromRabbitMessage(response, (Class<T>) Object.class);
        return Optional.of(message);
    }

    @Override
    protected void doSubscribe(String topic, SubscriptionImpl subscription) {
        // Create a queue bound to the exchange for this subscription
        String queue = exchangeName + "." + topic + "." + subscription.hashCode();
        
        rabbitClient.declareQueue(queue, false, false, true);
        rabbitClient.bindQueue(queue, exchangeName, topic);
        
        String consumerTag = rabbitClient.basicConsume(queue, true, 
            new RabbitMQClientAdapter.Consumer() {
                @Override
                @SuppressWarnings("unchecked")
                public void handleDelivery(String tag, long deliveryTag, String routingKey,
                                          RabbitMQClientAdapter.MessageProperties props, byte[] body) {
                    Message<?> message = fromRabbitDelivery(routingKey, props, body, 
                            (Class<?>) subscription.getPayloadType());
                    dispatchMessage(topic, message);
                }
            });
        
        // Store consumer tag for later cancellation
        subscription.getClass(); // Just to access it
    }

    @Override
    protected void doStart() {
        if (!rabbitClient.isConnected()) {
            throw new MessageException("RabbitMQ client is not connected");
        }
        
        // Declare the main exchange
        rabbitClient.declareExchange(exchangeName, "topic", durableQueues);
    }

    @Override
    protected void doStop() {
        // Consumer cancellation handled by subscription.cancel()
    }

    @Override
    protected void doClose() {
        rabbitClient.close();
    }

    @Override
    public boolean isConnected() {
        return running.get() && rabbitClient.isConnected();
    }

    @Override
    public void declareQueue(String queue, boolean durable) {
        rabbitClient.declareQueue(queue, durable, false, false);
    }

    @Override
    public void declareTopic(String topic) {
        // Topics are handled via routing keys in RabbitMQ
    }

    @Override
    public void bindQueue(String queue, String topic, String routingKey) {
        rabbitClient.bindQueue(queue, exchangeName, routingKey);
    }

    @Override
    public long getQueueSize(String queue) {
        return rabbitClient.getMessageCount(queue);
    }

    @Override
    public long purgeQueue(String queue) {
        return rabbitClient.purgeQueue(queue);
    }

    @Override
    public void acknowledge(Message<?> message) {
        // If message has delivery tag in headers, ack it
        String deliveryTagStr = message.getHeader("x-delivery-tag");
        if (deliveryTagStr != null) {
            long deliveryTag = Long.parseLong(deliveryTagStr);
            rabbitClient.basicAck(deliveryTag, false);
        }
    }

    @Override
    public void reject(Message<?> message, boolean requeue) {
        String deliveryTagStr = message.getHeader("x-delivery-tag");
        if (deliveryTagStr != null) {
            long deliveryTag = Long.parseLong(deliveryTagStr);
            rabbitClient.basicReject(deliveryTag, requeue);
        }
    }

    private <T> RabbitMQClientAdapter.MessageProperties buildProperties(Message<T> message) {
        var props = RabbitMQClientAdapter.MessageProperties.create()
                .contentType(serializer.getContentType())
                .messageId(message.getId())
                .priority(message.getPriority())
                .timestamp(java.util.Date.from(message.getTimestamp()));
        
        if (message.getCorrelationId() != null) {
            props.correlationId(message.getCorrelationId());
        }
        if (message.getReplyTo() != null) {
            props.replyTo(message.getReplyTo());
        }
        if (message.getTtlMillis() != null) {
            props.expiration(String.valueOf(message.getTtlMillis()));
        }
        
        // Convert headers
        java.util.Map<String, Object> headers = new java.util.HashMap<>();
        message.getHeaders().forEach(headers::put);
        props.headers(headers);
        
        return props;
    }

    private <T> Message<T> fromRabbitMessage(RabbitMQClientAdapter.GetResponse response, Class<T> type) {
        return fromRabbitDelivery(response.getRoutingKey(), response.getProperties(), 
                response.getBody(), type);
    }

    @SuppressWarnings("unchecked")
    private <T> Message<T> fromRabbitDelivery(String routingKey, 
                                               RabbitMQClientAdapter.MessageProperties props,
                                               byte[] body, Class<T> type) {
        T payload = serializer.deserialize(body, type);
        
        var builder = Message.<T>builder()
                .topic(routingKey)
                .payload(payload);
        
        if (props.getMessageId() != null) {
            builder.id(props.getMessageId());
        }
        if (props.getCorrelationId() != null) {
            builder.correlationId(props.getCorrelationId());
        }
        if (props.getReplyTo() != null) {
            builder.replyTo(props.getReplyTo());
        }
        if (props.getPriority() != null) {
            builder.priority(props.getPriority());
        }
        if (props.getTimestamp() != null) {
            builder.timestamp(props.getTimestamp().toInstant());
        }
        if (props.getExpiration() != null) {
            builder.ttlMillis(Long.parseLong(props.getExpiration()));
        }
        
        // Convert headers
        if (props.getHeaders() != null) {
            props.getHeaders().forEach((k, v) -> {
                if (v != null) {
                    builder.header(k, v.toString());
                }
            });
        }
        
        return builder.build();
    }
}
