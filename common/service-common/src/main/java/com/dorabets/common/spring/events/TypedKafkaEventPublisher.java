package com.dorabets.common.spring.events;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fern.events.core.EventEnvelope;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
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
    try {
      EventEnvelope<T> envelope = new EventEnvelope<>(
        UUID.randomUUID().toString(),
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
      kafkaProducer.send(record);
    } catch (Exception e) {
      throw new IllegalStateException("Failed to publish Kafka event " + eventType + " to " + topic, e);
    }
  }
}
