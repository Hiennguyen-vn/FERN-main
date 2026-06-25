package com.fern.services.sync.infrastructure;

import com.fasterxml.jackson.databind.JsonNode;
import com.fern.common.repository.BaseRepository;
import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.application.SyncPayloadHandler;
import com.fern.services.sync.model.AggregateType;
import com.fern.services.sync.model.EventType;
import java.sql.PreparedStatement;
import java.sql.Timestamp;
import java.time.Clock;
import javax.sql.DataSource;
import org.springframework.stereotype.Component;

@Component
public class StoreConfigSyncPayloadHandler extends BaseRepository implements SyncPayloadHandler {

  private final Clock clock;

  public StoreConfigSyncPayloadHandler(DataSource dataSource, Clock clock) {
    super(dataSource);
    this.clock = clock;
  }

  @Override
  public boolean supports(EventType eventType, AggregateType aggregateType) {
    return aggregateType == AggregateType.STORE_CONFIG && eventType == EventType.STORE_CONFIG_UPDATED;
  }

  @Override
  public void apply(SyncDtos.SyncEvent event) {
    JsonNode payload = event.payload();
    Long storeId = PayloadJson.longValue(payload, "storeId", PayloadJson.longValue(payload, "outletId", null));
    Long regionId = PayloadJson.longValue(payload, "regionId", null);
    if (storeId == null || regionId == null) {
      throw new IllegalArgumentException("STORE_CONFIG_UPDATED requires storeId and regionId");
    }
    executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.outlet (
            id, region_id, code, name, status, address, phone, email,
            opened_at, closed_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?::location_status_enum, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (id) DO UPDATE
          SET region_id = EXCLUDED.region_id,
              code = EXCLUDED.code,
              name = EXCLUDED.name,
              status = EXCLUDED.status,
              address = EXCLUDED.address,
              phone = EXCLUDED.phone,
              email = EXCLUDED.email,
              opened_at = EXCLUDED.opened_at,
              closed_at = EXCLUDED.closed_at,
              updated_at = EXCLUDED.updated_at
          """
      )) {
        Timestamp now = Timestamp.from(clock.instant());
        ps.setLong(1, storeId);
        ps.setLong(2, regionId);
        ps.setString(3, PayloadJson.text(payload, "code", event.aggregateId()));
        ps.setString(4, PayloadJson.text(payload, "name", event.aggregateId()));
        ps.setString(5, normalizeStatus(PayloadJson.text(payload, "status", "active")));
        ps.setString(6, PayloadJson.text(payload, "address", null));
        ps.setString(7, PayloadJson.text(payload, "phone", null));
        ps.setString(8, PayloadJson.text(payload, "email", null));
        ps.setObject(9, PayloadJson.date(payload, "openedAt", null));
        ps.setObject(10, PayloadJson.date(payload, "closedAt", null));
        ps.setTimestamp(11, now);
        ps.setTimestamp(12, now);
        ps.executeUpdate();
      }
      return null;
    });
  }

  private static String normalizeStatus(String status) {
    return switch (status == null ? "active" : status.trim().toLowerCase()) {
      case "inactive", "closed", "archived" -> status.trim().toLowerCase();
      default -> "active";
    };
  }
}
