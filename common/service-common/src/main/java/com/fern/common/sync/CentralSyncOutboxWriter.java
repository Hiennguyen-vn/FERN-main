package com.fern.common.sync;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;

public class CentralSyncOutboxWriter {

  private final ObjectMapper objectMapper;

  public CentralSyncOutboxWriter(ObjectMapper objectMapper) {
    ObjectMapper mapper = objectMapper.copy();
    mapper.registerModule(new JavaTimeModule());
    mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
    this.objectMapper = mapper;
  }

  public long nextVersion(Connection conn, String aggregateType, String aggregateId) {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT COALESCE(MAX(version), 0) + 1
        FROM core.central_outbox
        WHERE aggregate_type = ? AND aggregate_id = ?
        """
    )) {
      ps.setString(1, aggregateType);
      ps.setString(2, aggregateId);
      try (ResultSet rs = ps.executeQuery()) {
        if (rs.next()) {
          return rs.getLong(1);
        }
        return 1L;
      }
    } catch (Exception e) {
      throw new RuntimeException("Unable to allocate central sync version for "
          + aggregateType + ":" + aggregateId, e);
    }
  }

  public long append(
      Connection conn,
      String eventType,
      String aggregateType,
      String aggregateId,
      String targetScope,
      Long targetStoreId,
      Long targetStoreGroupId,
      Object payload,
      long version
  ) {
    try {
      String payloadJson = objectMapper.writeValueAsString(payload);
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.central_outbox (
            event_type, aggregate_type, aggregate_id, target_scope,
            target_store_id, target_store_group_id, payload_json, version
          ) VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?)
          RETURNING id
          """
      )) {
        ps.setString(1, eventType);
        ps.setString(2, aggregateType);
        ps.setString(3, aggregateId);
        ps.setString(4, targetScope);
        if (targetStoreId == null) {
          ps.setNull(5, java.sql.Types.BIGINT);
        } else {
          ps.setLong(5, targetStoreId);
        }
        if (targetStoreGroupId == null) {
          ps.setNull(6, java.sql.Types.BIGINT);
        } else {
          ps.setLong(6, targetStoreGroupId);
        }
        ps.setString(7, payloadJson);
        ps.setLong(8, version);
        try (ResultSet rs = ps.executeQuery()) {
          if (rs.next()) {
            return rs.getLong(1);
          }
        }
      }
      throw new IllegalStateException("central_outbox insert did not return id");
    } catch (Exception e) {
      throw new RuntimeException("Unable to append central sync event "
          + eventType + " for " + aggregateType + ":" + aggregateId, e);
    }
  }
}
