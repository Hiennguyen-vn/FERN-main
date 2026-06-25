package com.fern.common.sync;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import java.sql.Connection;
import java.sql.PreparedStatement;

public class LocalSyncOutboxWriter {

  private final ObjectMapper objectMapper;
  private final boolean enabled;

  public LocalSyncOutboxWriter(ObjectMapper objectMapper) {
    this(objectMapper, true);
  }

  public LocalSyncOutboxWriter(ObjectMapper objectMapper, boolean enabled) {
    ObjectMapper mapper = objectMapper.copy();
    mapper.registerModule(new JavaTimeModule());
    mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
    this.objectMapper = mapper;
    this.enabled = enabled;
  }

  public void append(
      Connection conn,
      String eventId,
      String eventType,
      String aggregateType,
      String aggregateId,
      Object payload
  ) {
    if (!enabled) {
      return;
    }
    try {
      String payloadJson = objectMapper.writeValueAsString(payload);
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.sync_outbox (
            id, event_type, aggregate_type, aggregate_id, payload_json, status, retry_count
          ) VALUES (?, ?, ?, ?, ?::jsonb, 'PENDING', 0)
          ON CONFLICT (id) DO NOTHING
          """
      )) {
        ps.setString(1, eventId);
        ps.setString(2, eventType);
        ps.setString(3, aggregateType);
        ps.setString(4, aggregateId);
        ps.setString(5, payloadJson);
        ps.executeUpdate();
      }
    } catch (Exception e) {
      throw new RuntimeException("Unable to append local sync event "
          + eventType + " for " + aggregateType + ":" + aggregateId, e);
    }
  }
}
