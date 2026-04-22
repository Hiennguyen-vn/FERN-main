package com.fern.simulator.persistence;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.fern.simulator.model.SimOutlet;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.common.serialization.StringSerializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Optional Kafka publisher for simulator. Publishes fern.org.outlet-created events after
 * DB inserts so auth-service OrgEventConsumer can fan-out user_role rows.
 *
 * Key = regionId (matches org-service convention) for same-region ordering guarantee.
 */
public class SimulatorKafkaPublisher implements AutoCloseable {

    private static final Logger log = LoggerFactory.getLogger(SimulatorKafkaPublisher.class);
    private static final String TOPIC = "fern.org.outlet-created";
    private static final String SOURCE = "data-simulator";

    private final KafkaProducer<String, String> producer;
    private final ObjectMapper objectMapper;

    public SimulatorKafkaPublisher(String bootstrapServers) {
        Properties props = new Properties();
        props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);
        props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());
        props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());
        props.put(ProducerConfig.ACKS_CONFIG, "1");
        props.put(ProducerConfig.RETRIES_CONFIG, 3);
        props.put(ProducerConfig.LINGER_MS_CONFIG, 5);

        this.producer = new KafkaProducer<>(props);
        this.objectMapper = new ObjectMapper()
                .registerModule(new JavaTimeModule())
                .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);

        log.info("SimulatorKafkaPublisher initialized: bootstrap={}", bootstrapServers);
    }

    public void publishOutletsCreated(List<SimOutlet> outlets) {
        if (outlets.isEmpty()) return;
        for (SimOutlet outlet : outlets) {
            try {
                String payload = buildEnvelope(outlet);
                String key = Long.toString(outlet.getRegionId());
                ProducerRecord<String, String> record = new ProducerRecord<>(TOPIC, key, payload);
                producer.send(record, (metadata, ex) -> {
                    if (ex != null) {
                        log.error("Failed to publish outlet-created for outletId={}: {}",
                                outlet.getId(), ex.getMessage());
                    } else {
                        log.debug("Published outlet-created outletId={} regionId={} partition={} offset={}",
                                outlet.getId(), outlet.getRegionId(),
                                metadata.partition(), metadata.offset());
                    }
                });
            } catch (Exception e) {
                log.error("Error building outlet-created event for outletId={}: {}",
                        outlet.getId(), e.getMessage(), e);
            }
        }
        producer.flush();
        log.info("Published {} outlet-created events to {}", outlets.size(), TOPIC);
    }

    private String buildEnvelope(SimOutlet outlet) throws Exception {
        Map<String, Object> payload = Map.of(
                "outletId", outlet.getId(),
                "regionId", outlet.getRegionId(),
                "code", outlet.getCode(),
                "name", outlet.getName(),
                "status", outlet.getStatus() != null ? outlet.getStatus() : "active",
                "openedAt", outlet.getOpenedDate() != null ? outlet.getOpenedDate().toString() : "",
                "createdAt", Instant.now().toString(),
                "createdByUserId", (Object) null
        );
        Map<String, Object> envelope = Map.of(
                "eventId", UUID.randomUUID().toString(),
                "aggregateId", Long.toString(outlet.getRegionId()),
                "eventType", "org.outlet.created",
                "timestamp", Instant.now().toString(),
                "sourceComponent", SOURCE,
                "version", 1,
                "payload", payload
        );
        return objectMapper.writeValueAsString(envelope);
    }

    @Override
    public void close() {
        try {
            producer.close();
            log.info("SimulatorKafkaPublisher closed");
        } catch (Exception e) {
            log.warn("Error closing Kafka producer: {}", e.getMessage());
        }
    }
}
