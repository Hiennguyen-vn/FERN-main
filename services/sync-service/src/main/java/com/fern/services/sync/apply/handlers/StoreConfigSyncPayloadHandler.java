package com.fern.services.sync.apply.handlers;

import com.fasterxml.jackson.databind.JsonNode;
import com.fern.common.repository.BaseRepository;
import com.fern.services.sync.apply.PayloadJson;
import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.apply.SyncPayloadHandler;
import com.fern.services.sync.model.AggregateType;
import com.fern.services.sync.model.EventType;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Clock;
import javax.sql.DataSource;
<<<<<<< Updated upstream:services/sync-service/src/main/java/com/fern/services/sync/apply/handlers/StoreConfigSyncPayloadHandler.java
import org.springframework.context.annotation.Primary;
=======
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
>>>>>>> Stashed changes:services/sync-service/src/main/java/com/fern/services/sync/infrastructure/StoreConfigSyncPayloadHandler.java
import org.springframework.stereotype.Component;

/**
 * Apply STORE_CONFIG_UPDATED events at the store-edge.
 *
 * Dependency guard: core.outlet has a FK on core.region(id). If the region is
 * not yet present locally (REGION_UPDATED not yet received or not yet applied),
 * we record a MISSING_DEPENDENCY conflict instead of crashing the entire sync job.
 * The sync scheduler will retry on the next cycle; by then the region event should
 * have been applied by RegionSyncPayloadHandler (central outbox is ordered by id ASC
 * and region events are published before outlet events).
 */
@Component
@Primary
public class StoreConfigSyncPayloadHandler extends BaseRepository implements SyncPayloadHandler {

  private static final Logger log = LoggerFactory.getLogger(StoreConfigSyncPayloadHandler.class);

  private final Clock clock;
  private final SyncRepository syncRepository;

  public StoreConfigSyncPayloadHandler(DataSource dataSource, Clock clock, SyncRepository syncRepository) {
    super(dataSource);
    this.clock = clock;
    this.syncRepository = syncRepository;
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

    // WAITING_DEPENDENCY guard: check region exists before attempting FK insert
    if (!regionExistsLocally(regionId)) {
      log.warn("STORE_CONFIG_UPDATED for outlet {} requires region {} which is not yet applied locally. "
          + "Recording conflict; will retry on next sync cycle.", storeId, regionId);
      recordMissingDependencyConflict(event, "Region " + regionId + " not yet applied locally");
      return;
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

  private boolean regionExistsLocally(long regionId) {
    return queryOne(
        "SELECT 1 FROM core.region WHERE id = ?",
        rs -> true,
        regionId
    ).isPresent();
  }

  private void recordMissingDependencyConflict(SyncDtos.SyncEvent event, String reason) {
    syncRepository.recordConflict(event, "MISSING_DEPENDENCY", reason);
  }

  private static String normalizeStatus(String status) {
    return switch (status == null ? "active" : status.trim().toLowerCase()) {
      case "inactive", "closed", "archived" -> status.trim().toLowerCase();
      default -> "active";
    };
  }
}
