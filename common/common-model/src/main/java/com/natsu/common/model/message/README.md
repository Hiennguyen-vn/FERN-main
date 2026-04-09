# Message Queue Module

A flexible message queue abstraction supporting local, socket-based, Redis, and RabbitMQ messaging with pub/sub and request-reply patterns.

## Overview

The message queue module provides:
- **Multiple Backends**: Local (in-memory), Socket, Redis, RabbitMQ
- **Pub/Sub Pattern**: Subscribe to topics and publish messages
- **Request/Reply Pattern**: Synchronous request-response messaging
- **Serialization**: JSON, binary, and custom serializers
- **Unified Configuration**: `MessageQueueConfig` with ServicesRegistry integration

## Architecture

```
message/
├── MessageQueue.java           # Core message queue interface
├── AbstractMessageQueue.java   # Base implementation
├── MessageQueueConfig.java     # Configuration (implements ServiceConfig)
├── MessageQueueFactory.java    # Factory for creating queues
├── Message.java                # Message wrapper
├── MessageHandler.java         # Message handler interface
├── MessagePublisher.java       # Publisher interface
├── MessageSubscriber.java      # Subscriber interface
├── MessageSerializer.java      # Serialization abstraction
├── MessageException.java       # Queue-specific exception
├── MessageQueueStats.java      # Statistics tracking
├── RequestReply.java           # Request-reply pattern support
├── LocalMessageQueue.java      # In-memory implementation
├── SocketMessageQueue.java     # TCP socket implementation
├── RedisMessageQueue.java      # Redis pub/sub implementation
└── RabbitMQMessageQueue.java   # RabbitMQ implementation
```

## Quick Start

### Local Queue (In-Memory)

```java
// Create local queue
MessageQueue queue = MessageQueueFactory.getInstance().createLocal("events");

// Subscribe to topic
queue.subscribe("user.created", message -> {
    User user = message.getPayload(User.class);
    System.out.println("User created: " + user.getName());
});

// Publish message
queue.publish("user.created", new User("John", "john@example.com"));

// Cleanup
queue.close();
```

### Socket Queue (TCP)

```java
// Server
SocketMessageQueue server = MessageQueueFactory.getInstance().createSocketServer(9999);
server.start();
server.subscribe("orders", message -> processOrder(message.getPayload(Order.class)));

// Client
SocketMessageQueue client = MessageQueueFactory.getInstance().createSocketClient("localhost", 9999);
client.connect();
client.publish("orders", new Order("item-123", 2));
```

### Redis Queue

```java
// Create with adapter
MessageQueueConfig config = MessageQueueConfig.redis()
    .name("redis-queue")
    .redisClient(myRedisAdapter)
    .redisKeyPrefix("myapp:mq:")
    .build();

MessageQueue queue = MessageQueueFactory.getInstance().create(config);

queue.subscribe("notifications", message -> {
    sendNotification(message.getPayload(Notification.class));
});

queue.publish("notifications", new Notification("Hello!"));
```

### RabbitMQ

```java
MessageQueueConfig config = MessageQueueConfig.rabbitmq()
    .name("rabbit-queue")
    .rabbitClient(myRabbitAdapter)
    .exchangeName("myapp.exchange")
    .durableQueues(true)
    .build();

MessageQueue queue = MessageQueueFactory.getInstance().create(config);

queue.subscribe("tasks", this::handleTask);
queue.publish("tasks", new Task("process-data"));
```

## Configuration

### MessageQueueConfig

```java
// Local queue
MessageQueueConfig local = MessageQueueConfig.local()
    .name("events")
    .maxQueueSize(10000)
    .serializer(MessageSerializer.json())
    .build();

// Socket server
MessageQueueConfig socketServer = MessageQueueConfig.socket()
    .name("socket-server")
    .port(9999)
    .serverMode(true)
    .build();

// Socket client
MessageQueueConfig socketClient = MessageQueueConfig.socket()
    .name("socket-client")
    .host("localhost")
    .port(9999)
    .serverMode(false)
    .build();

// Redis
MessageQueueConfig redis = MessageQueueConfig.redis()
    .name("redis-queue")
    .redisClient(adapter)
    .redisKeyPrefix("app:mq:")
    .build();

// RabbitMQ
MessageQueueConfig rabbit = MessageQueueConfig.rabbitmq()
    .name("rabbit-queue")
    .rabbitClient(adapter)
    .exchangeName("myapp")
    .durableQueues(true)
    .build();
```

## ServicesRegistry Integration

```java
// Register configuration
ServicesRegistry.register(MessageQueueConfig.local().name("events").build());

// Create from registry
MessageQueue queue = MessageQueueFactory.getInstance().createFromRegistry("events");

// Get or create (returns existing if already created)
MessageQueue queue = MessageQueueFactory.getInstance().getOrCreateFromRegistry("events");

// Create all registered queues (LOCAL and SOCKET only)
MessageQueueFactory.getInstance().createAllFromRegistry();
```

## MessageQueueFactory

```java
MessageQueueFactory factory = MessageQueueFactory.getInstance();

// Create from config
MessageQueue queue = factory.create(config);

// Convenience methods
LocalMessageQueue local = factory.createLocal("events");
SocketMessageQueue server = factory.createSocketServer(9999);
SocketMessageQueue client = factory.createSocketClient("localhost", 9999);
RedisMessageQueue redis = factory.createRedis(redisAdapter);
RabbitMQMessageQueue rabbit = factory.createRabbitMQ(rabbitAdapter);

// Registry operations
MessageQueue queue = factory.get("events");
MessageQueue queue = factory.getOrCreate("events", config);

// Cleanup
factory.close("events");
factory.closeAll();
```

## Message Handling

### Subscribe to Topics

```java
// Lambda handler
queue.subscribe("user.created", message -> {
    User user = message.getPayload(User.class);
    processUser(user);
});

// Method reference
queue.subscribe("orders", this::handleOrder);

// Multiple topics
queue.subscribe("user.*", message -> {
    // Handles user.created, user.updated, user.deleted
});

// Unsubscribe
Subscription sub = queue.subscribe("events", handler);
sub.unsubscribe();
```

### Publish Messages

```java
// Simple publish
queue.publish("topic", payload);

// With metadata
Message message = Message.of(payload)
    .withHeader("correlationId", UUID.randomUUID().toString())
    .withHeader("timestamp", Instant.now())
    .withTopic("user.created");

queue.publish(message);

// Async publish
CompletableFuture<Void> future = queue.publishAsync("topic", payload);
future.thenRun(() -> System.out.println("Published!"));
```

## Request/Reply Pattern

```java
// Server side - register handler
RequestReply rpc = RequestReply.create(queue);
rpc.handle("calculate", request -> {
    CalculateRequest req = request.getPayload(CalculateRequest.class);
    return new CalculateResponse(req.getA() + req.getB());
});

// Client side - make request
CalculateResponse response = rpc.request("calculate", 
    new CalculateRequest(5, 3), 
    CalculateResponse.class,
    Duration.ofSeconds(5));  // timeout

System.out.println("Result: " + response.getResult());  // 8

// Async request
CompletableFuture<CalculateResponse> future = rpc.requestAsync(
    "calculate", 
    new CalculateRequest(10, 20), 
    CalculateResponse.class
);
```

## Serialization

```java
// JSON (default)
MessageSerializer json = MessageSerializer.json();

// Binary (Java serialization)
MessageSerializer binary = MessageSerializer.binary();

// Custom serializer
MessageSerializer custom = new MessageSerializer() {
    @Override
    public byte[] serialize(Object obj) {
        // Custom serialization
    }
    
    @Override
    public <T> T deserialize(byte[] data, Class<T> type) {
        // Custom deserialization
    }
};

// Use in config
MessageQueueConfig config = MessageQueueConfig.local()
    .serializer(custom)
    .build();
```

## Client Adapters

### Redis Adapter

```java
public class JedisAdapter implements RedisMessageQueue.RedisClientAdapter {
    private final JedisPool pool;
    
    @Override
    public void publish(String channel, String message) {
        try (Jedis jedis = pool.getResource()) {
            jedis.publish(channel, message);
        }
    }
    
    @Override
    public void subscribe(String channel, Consumer<String> handler) {
        // Subscribe using Jedis pub/sub
    }
    
    @Override
    public void close() {
        pool.close();
    }
}
```

### RabbitMQ Adapter

```java
public class RabbitAdapter implements RabbitMQMessageQueue.RabbitMQClientAdapter {
    private final Channel channel;
    
    @Override
    public void publish(String exchange, String routingKey, byte[] message) {
        channel.basicPublish(exchange, routingKey, null, message);
    }
    
    @Override
    public void subscribe(String queue, Consumer<byte[]> handler) {
        channel.basicConsume(queue, true, (tag, delivery) -> {
            handler.accept(delivery.getBody());
        }, tag -> {});
    }
    
    @Override
    public void declareQueue(String name, boolean durable) {
        channel.queueDeclare(name, durable, false, false, null);
    }
}
```

## Statistics

```java
MessageQueueStats stats = queue.getStats();

System.out.println("Published: " + stats.getPublishedCount());
System.out.println("Received: " + stats.getReceivedCount());
System.out.println("Failed: " + stats.getFailedCount());
System.out.println("Avg latency: " + stats.getAverageLatency() + "ms");
```

## Exception Handling

```java
try {
    queue.publish("topic", message);
} catch (MessageException e) {
    System.err.println("Failed to publish: " + e.getMessage());
    // Retry logic, dead letter queue, etc.
}
```

## Queue Types Comparison

| Feature | Local | Socket | Redis | RabbitMQ |
|---------|-------|--------|-------|----------|
| Persistence | No | No | Optional | Yes |
| Distributed | No | Yes | Yes | Yes |
| Clustering | No | No | Yes | Yes |
| Performance | Highest | High | High | Medium |
| Use Case | Testing, Single JVM | Simple IPC | Pub/Sub | Enterprise |

## Testing

```java
@BeforeEach
void setUp() {
    queue = MessageQueueFactory.getInstance().createLocal("test");
}

@AfterEach
void tearDown() {
    MessageQueueFactory.getInstance().closeAll();
}

@Test
void testPubSub() throws Exception {
    CountDownLatch latch = new CountDownLatch(1);
    AtomicReference<String> received = new AtomicReference<>();
    
    queue.subscribe("test", message -> {
        received.set(message.getPayload(String.class));
        latch.countDown();
    });
    
    queue.publish("test", "Hello");
    
    assertTrue(latch.await(1, TimeUnit.SECONDS));
    assertEquals("Hello", received.get());
}
```

## Thread Safety

- All queue implementations are thread-safe
- Handlers may be called from multiple threads
- Use thread-safe data structures in handlers
