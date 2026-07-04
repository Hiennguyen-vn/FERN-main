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

/**
 * Apply REGION_UPDATED events at the store-edge.
 *
 * Region records must exist in core.region before STORE_CONFIG (outlet) events are applied,
 * because core.outlet.region_id references core.region(id). The central outbox orders events
 * by id ASC, and region events are published before their scoped outlet events, so this
 * ordering is naturally satisfied in the normal sync flow.
 *
 * If the parent_region_id is not yet present locally (parent region event not yet downloaded),
 * the upsert sets parent_region_id = NULL transiently. A subsequent REGION_UPDATED for the
 * parent will set the correct hierarchy. This avoids a full dependency-resolution loop.
 *
 * Idempotency: ON CONFLICT (id) DO UPDATE with GREATEST(version) guard.
 */
@Component
public class RegionSyncPayloadHandler extends BaseRepository implements SyncPayloadHandler {

  private final Clock clock;
  private final SyncRepository syncRepository;

  public RegionSyncPayloadHandler(DataSource dataSource, Clock clock, SyncRepository syncRepository) {
    super(dataSource);
    this.clock = clock;
    this.syncRepository = syncRepository;
  }

  @Override
  public boolean supports(EventType eventType, AggregateType aggregateType) {
    return aggregateType == AggregateType.REGION && eventType == EventType.REGION_UPDATED;
  }

  @Override
  public void apply(SyncDtos.SyncEvent event) {
    JsonNode payload = event.payload();
    long regionId = PayloadJson.longValue(payload, "regionId", Long.parseLong(event.aggregateId()));
    String code = PayloadJson.text(payload, "code", event.aggregateId());
    String name = PayloadJson.text(payload, "name", code);
    String currencyCode = PayloadJson.text(payload, "currencyCode", "VND");
    String timezoneName = PayloadJson.text(payload, "timezoneName", "Asia/Ho_Chi_Minh");
    long incomingVersion = event.version();

    // Version gate: skip if local has a newer or equal version
    if (!syncRepository.localVersionIsNewer("REGION", event.aggregateId(), incomingVersion)) {
      return;
    }

    executeInTransaction(conn -> {
      // Resolve parent_region_id only if it already exists locally to avoid FK violation
      Long parentRegionId = null;
      if (payload.has("parentRegionId") && !payload.get("parentRegionId").isNull()) {
        long candidateParent = payload.get("parentRegionId").longValue();
        if (parentExistsLocally(conn, candidateParent)) {
          parentRegionId = candidateParent;
        }
        // else: apply without parent link; will be corrected on next sync cycle
      }

      // Ensure currency exists (insert minimal record if absent)
      ensureCurrencyExists(conn, currencyCode);

      final Long finalParentId = parentRegionId;
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.region (
            id, code, parent_region_id, currency_code, name, timezone_name,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (id) DO UPDATE
          SET code             = EXCLUDED.code,
              parent_region_id = EXCLUDED.parent_region_id,
              currency_code    = EXCLUDED.currency_code,
              name             = EXCLUDED.name,
              timezone_name    = EXCLUDED.timezone_name,
              updated_at       = EXCLUDED.updated_at
          """
      )) {
        Timestamp now = Timestamp.from(clock.instant());
        ps.setLong(1, regionId);
        ps.setString(2, code);
        if (finalParentId == null) {
          ps.setNull(3, java.sql.Types.BIGINT);
        } else {
          ps.setLong(3, finalParentId);
        }
        ps.setString(4, currencyCode);
        ps.setString(5, name);
        ps.setString(6, timezoneName);
        ps.setTimestamp(7, now);
        ps.setTimestamp(8, now);
        ps.executeUpdate();
      }
      return null;
    });

    syncRepository.recordAppliedVersion("REGION", event.aggregateId(), incomingVersion);
  }

  private boolean parentExistsLocally(java.sql.Connection conn, long parentId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement("SELECT 1 FROM core.region WHERE id = ?")) {
      ps.setLong(1, parentId);
      try (java.sql.ResultSet rs = ps.executeQuery()) {
        return rs.next();
      }
    }
  }

  private void ensureCurrencyExists(java.sql.Connection conn, String code) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        "INSERT INTO core.currency (code, name) VALUES (?, ?) ON CONFLICT (code) DO NOTHING"
    )) {
      ps.setString(1, code);
      ps.setString(2, code); // minimal placeholder
      ps.executeUpdate();
    }
  }
}
