package com.fern.common.spring.events;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fern.events.core.EventEnvelope;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.util.concurrent.TimeUnit;
import java.util.UUID;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerRecord;

public class TypedKafkaEventPublisher {

  private final KafkaProducer<String, String> kafkaProducer;
  private final ObjectMapper objectMapper;
  private final Clock clock;
  private final String sourceComponent;

  public TypedKafkaEventPublisher(
    KafkaProducer<String, String> kafkaProducer,
    ObjectMapper objectMapper,
    Clock clock,
    String sourceComponent
  ) {
    this.kafkaProducer = kafkaProducer;
    this.objectMapper = objectMapper;
    this.clock = clock;
    this.sourceComponent = sourceComponent;
  }

  public <T> void publish(String topic, String aggregateId, String eventType, T payload) {
    publish(topic, aggregateId, eventType, payload, null);
  }

  public <T> void publish(String topic, String aggregateId, String eventType, T payload, String traceId) {
    publishInternal(null, topic, aggregateId, eventType, payload, traceId, false);
  }

  public <T> void publishAndAwait(String topic, String aggregateId, String eventType, T payload) {
    publishAndAwait(topic, aggregateId, eventType, payload, null);
  }

  public <T> void publishAndAwait(String topic, String aggregateId, String eventType, T payload, String traceId) {
    publishInternal(null, topic, aggregateId, eventType, payload, traceId, true);
  }

  /**
   * Outbox relay overload: caller supplies deterministic eventId so reclaim/retry
   * yields identical envelope.eventId. See UuidV5.fromOutboxId.
   */
  public <T> void publishAndAwaitWithId(String eventId, String topic, String aggregateId,
      String eventType, T payload, String traceId) {
    publishInternal(eventId, topic, aggregateId, eventType, payload, traceId, true);
  }

  private <T> void publishInternal(
      String eventIdOrNull,
      String topic,
      String aggregateId,
      String eventType,
      T payload,
      String traceId,
      boolean awaitAck
  ) {
    try {
      EventEnvelope<T> envelope = new EventEnvelope<>(
        eventIdOrNull != null ? eventIdOrNull : UUID.randomUUID().toString(),
        aggregateId,
        eventType,
        clock.instant(),
        sourceComponent,
        1,
        payload
      );
      ProducerRecord<String, String> record = new ProducerRecord<>(
        topic,
        aggregateId,
        objectMapper.writeValueAsString(envelope)
      );
      if (traceId != null && !traceId.isBlank()) {
        record.headers().add("x-trace-id", traceId.getBytes(StandardCharsets.UTF_8));
      }
      if (awaitAck) {
        kafkaProducer.send(record).get(30, TimeUnit.SECONDS);
      } else {
        kafkaProducer.send(record);
      }
    } catch (Exception e) {
      throw new IllegalStateException("Failed to publish Kafka event " + eventType + " to " + topic, e);
    }
  }
}
