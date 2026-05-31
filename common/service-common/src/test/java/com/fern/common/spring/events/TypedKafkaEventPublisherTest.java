package com.fern.common.spring.events;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.concurrent.CompletableFuture;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class TypedKafkaEventPublisherTest {

  @Test
  void publishAndAwaitWithIdUsesSuppliedEnvelopeMetadata() throws Exception {
    @SuppressWarnings("unchecked")
    KafkaProducer<String, String> producer = org.mockito.Mockito.mock(KafkaProducer.class);
    ObjectMapper mapper = new ObjectMapper()
        .registerModule(new JavaTimeModule())
        .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
    Instant outboxCreatedAt = Instant.parse("2026-05-20T04:04:34.363464Z");
    TypedKafkaEventPublisher publisher = new TypedKafkaEventPublisher(
        producer,
        mapper,
        Clock.fixed(Instant.parse("2026-05-20T04:10:00Z"), ZoneOffset.UTC),
        "inventory-service"
    );
    when(producer.send(any())).thenReturn(CompletableFuture.completedFuture(null));

    JsonNode payload = mapper.createObjectNode().put("goodsReceiptId", 3492030898147168256L);
    publisher.publishAndAwaitWithId(
        "stable-event-id",
        "fern.procurement.goods-receipt-posted",
        "3492030898147168256",
        "goods_receipt",
        payload,
        null,
        outboxCreatedAt,
        "procurement-service"
    );

    ArgumentCaptor<ProducerRecord<String, String>> captor = ArgumentCaptor.forClass(ProducerRecord.class);
    verify(producer).send(captor.capture());
    JsonNode envelope = mapper.readTree(captor.getValue().value());
    assertEquals("stable-event-id", envelope.get("eventId").asText());
    assertEquals("3492030898147168256", envelope.get("aggregateId").asText());
    assertEquals("goods_receipt", envelope.get("eventType").asText());
    assertEquals(outboxCreatedAt, Instant.parse(envelope.get("timestamp").asText()));
    assertEquals("procurement-service", envelope.get("sourceComponent").asText());
    assertEquals(3492030898147168256L, envelope.get("payload").get("goodsReceiptId").asLong());
  }
}
