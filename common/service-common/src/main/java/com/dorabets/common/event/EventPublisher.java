package com.dorabets.common.event;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.clients.producer.RecordMetadata;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Future;

/**
 * Publishes domain events to Kafka topics with correlation metadata.
 */
public class EventPublisher {

    private static final Logger log = LoggerFactory.getLogger(EventPublisher.class);

    private final KafkaProducer<String, String> producer;
    private final ObjectMapper mapper;
    private final String serviceName;

    public EventPublisher(KafkaProducer<String, String> producer, ObjectMapper mapper, String serviceName) {
        this.producer = producer;
        this.mapper = mapper;
        this.serviceName = serviceName;
    }

    public Future<RecordMetadata> publish(String topic, String partitionKey, String eventType, Map<String, Object> payload) {
        return publish(topic, partitionKey, eventType, payload, null);
    }

    public Future<RecordMetadata> publish(String topic, String partitionKey, String eventType,
                                          Map<String, Object> payload, String traceId) {
        try {
            Map<String, Object> envelope = new LinkedHashMap<>();
            envelope.put("event_id", UUID.randomUUID().toString());
            envelope.put("event_type", eventType);
            envelope.put("source_service", serviceName);
            envelope.put("produced_at", Instant.now().toString());
            envelope.put("trace_id", traceId != null ? traceId : UUID.randomUUID().toString());
            envelope.put("schema_version", "v1");
            envelope.put("payload", payload);

            String json = mapper.writeValueAsString(envelope);
            String key = partitionKey != null ? partitionKey : UUID.randomUUID().toString();
            ProducerRecord<String, String> record = new ProducerRecord<>(topic, key, json);

            return producer.send(record, (meta, ex) -> {
                if (ex != null) {
                    log.error("Failed to publish event {} to {}: {}", eventType, topic, ex.getMessage());
                } else {
                    log.debug("Published {} to {}[{}]@{}", eventType, topic, meta.partition(), meta.offset());
                }
            });
        } catch (Exception e) {
            log.error("Event publish failed for {}: {}", eventType, e.getMessage());
            return null;
        }
    }
}
