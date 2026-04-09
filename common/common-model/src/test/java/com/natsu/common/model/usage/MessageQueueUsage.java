package com.natsu.common.model.usage;

import com.natsu.common.model.message.MessageQueueConfig;
import com.natsu.common.utils.services.ServiceCategory;
import com.natsu.common.utils.services.ServicesRegistry;

/**
 * Usage example for Message Queue features.
 * Demonstrates:
 * 1. Defining MessageQueueConfig.
 * 2. Registering with ServicesRegistry.
 */
public final class MessageQueueUsage {

    public static void main(String[] args) {
        System.out.println("=== Message Queue Usage Example ===");

        // 1. Create MQ Config (RabbitMQ)
        MessageQueueConfig rabbitConfig = MessageQueueConfig.rabbitmq()
                .name("order-events")
                .host("localhost")
                .port(5672) // AMQP port
                .durableQueues(true)
                .exchangeName("orders.exchange")
                .build();

        // 2. Register
        System.out.println("Registering MQ Config: " + rabbitConfig.getName());
        ServicesRegistry.registerConfig(rabbitConfig);

        // Verify
        boolean exists = ServicesRegistry.containsConfig("order-events", ServiceCategory.MESSAGE_QUEUE);
        System.out.println("Config registered: " + exists);

        // 3. Local MQ Example
        MessageQueueConfig localConfig = MessageQueueConfig.local()
                .name("internal-events")
                .maxQueueSize(100)
                .build();

        ServicesRegistry.registerConfig(localConfig);
        System.out.println("Registered Local MQ: " + localConfig.getName());

        // 4. Usage with Factory (Conceptually)
        // MessageQueue mq =
        // MessageQueueFactory.getInstance().createFromRegistry("order-events");
        // mq.publish("New Order Created");

        System.out.println("\n=== Done ===");
    }
}
