package com.fern.common.test;

import java.util.Map;
import java.util.Properties;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.apache.kafka.common.serialization.StringSerializer;
import org.junit.jupiter.api.extension.BeforeAllCallback;
import org.junit.jupiter.api.extension.ExtensionContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.testcontainers.containers.KafkaContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * JUnit 5 extension that boots a single embedded Kafka container per JVM. Reused across test classes
 * via {@code withReuse(true)}. Exposes bootstrap servers + ready-to-use producer/consumer properties.
 */
public class KafkaContainerExtension implements BeforeAllCallback {

  private static final Logger log = LoggerFactory.getLogger(KafkaContainerExtension.class);
  private static final String IMAGE = "confluentinc/cp-kafka:7.5.3";

  private static volatile KafkaContainer container;

  public static synchronized String bootstrapServers() {
    ensureStarted();
    return container.getBootstrapServers();
  }

  public static Properties producerProps(String clientId) {
    Properties p = new Properties();
    p.putAll(Map.of(
        ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers(),
        ProducerConfig.CLIENT_ID_CONFIG, clientId,
        ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName(),
        ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName(),
        ProducerConfig.ACKS_CONFIG, "all",
        ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, "true"
    ));
    return p;
  }

  public static Properties consumerProps(String groupId) {
    Properties p = new Properties();
    p.putAll(Map.of(
        ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers(),
        ConsumerConfig.GROUP_ID_CONFIG, groupId,
        ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName(),
        ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName(),
        ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest",
        ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, "false"
    ));
    return p;
  }

  @Override
  public void beforeAll(ExtensionContext context) {
    ensureStarted();
  }

  private static synchronized void ensureStarted() {
    if (container != null) {
      return;
    }
    container = new KafkaContainer(DockerImageName.parse(IMAGE))
        .withReuse(true);
    container.start();
    log.info("Kafka test container ready: bootstrap={}", container.getBootstrapServers());
    Runtime.getRuntime().addShutdownHook(new Thread(() -> {
      try {
        container.stop();
      } catch (Exception ignored) {
      }
    }));
  }
}
