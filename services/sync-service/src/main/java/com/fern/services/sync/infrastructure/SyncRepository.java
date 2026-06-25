package com.fern.services.sync.infrastructure;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fern.common.repository.BaseRepository;
import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.model.AggregateType;
import com.fern.services.sync.model.EventType;
import com.fern.services.sync.model.SyncStatus;
import com.fern.services.sync.model.TargetScope;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import javax.sql.DataSource;
import org.springframework.stereotype.Repository;

@Repository
public class SyncRepository extends BaseRepository {

  private final ObjectMapper objectMapper;
  private final Clock clock;

  public SyncRepository(DataSource dataSource, ObjectMapper objectMapper, Clock clock) {
    super(dataSource);
    this.objectMapper = objectMapper;
    this.clock = clock;
  }

  public Optional<SyncNodeRow> findActiveNode(String nodeId, long storeId) {
    return queryOne(
        """
        SELECT id, store_id, node_code, status
        FROM core.sync_nodes
        WHERE id = ? AND store_id = ? AND status = 'ACTIVE'
        """,
        rs -> new SyncNodeRow(text(rs, "id"), rsLong(rs, "store_id"), text(rs, "node_code"), text(rs, "status")),
        nodeId,
        storeId
    );
  }

  public ProvisionedNodeRow provisionNode(
      String nodeId,
      long storeId,
      String nodeCode,
      String nodeName,
      String nodeType,
      long deviceId,
      int workerId,
      String clientSecretHash,
      String hardwareFingerprint,
      String publicKey
  ) {
    return executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.sync_nodes (
            id, store_id, node_code, node_name, node_type, device_id, worker_id,
            client_secret_hash, hardware_fingerprint, public_key, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
          ON CONFLICT (node_code) DO UPDATE
          SET store_id = EXCLUDED.store_id,
              node_name = EXCLUDED.node_name,
              node_type = EXCLUDED.node_type,
              device_id = EXCLUDED.device_id,
              worker_id = EXCLUDED.worker_id,
              client_secret_hash = EXCLUDED.client_secret_hash,
              hardware_fingerprint = EXCLUDED.hardware_fingerprint,
              public_key = EXCLUDED.public_key,
              status = 'ACTIVE',
              updated_at = EXCLUDED.updated_at
          RETURNING id, store_id, node_code, node_name, device_id, worker_id, client_secret_hash
          """
      )) {
        Timestamp now = Timestamp.from(clock.instant());
        ps.setString(1, nodeId);
        ps.setLong(2, storeId);
        ps.setString(3, nodeCode);
        ps.setString(4, nodeName);
        ps.setString(5, nodeType);
        ps.setLong(6, deviceId);
        ps.setInt(7, workerId);
        ps.setString(8, clientSecretHash);
        ps.setString(9, hardwareFingerprint);
        ps.setString(10, publicKey);
        ps.setTimestamp(11, now);
        ps.setTimestamp(12, now);
        try (ResultSet rs = ps.executeQuery()) {
          rs.next();
          return mapProvisionedNode(rs);
        }
      }
    });
  }

  public Optional<ProvisionedNodeRow> findProvisionedNode(String nodeId, long storeId) {
    return queryOne(
        """
        SELECT id, store_id, node_code, node_name, device_id, worker_id, client_secret_hash
        FROM core.sync_nodes
        WHERE id = ? AND store_id = ? AND status = 'ACTIVE'
        """,
        this::mapProvisionedNode,
        nodeId,
        storeId
    );
  }

  public ProvisionedNodeRow rotateNodeSecret(String nodeId, String clientSecretHash) {
    return executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          UPDATE core.sync_nodes
          SET client_secret_hash = ?,
              status = 'ACTIVE',
              updated_at = ?
          WHERE id = ?
          RETURNING id, store_id, node_code, node_name, device_id, worker_id, client_secret_hash
          """
      )) {
        ps.setString(1, clientSecretHash);
        ps.setTimestamp(2, Timestamp.from(clock.instant()));
        ps.setString(3, nodeId);
        try (ResultSet rs = ps.executeQuery()) {
          if (!rs.next()) {
            throw com.fern.common.middleware.ServiceException.notFound("Sync node not found: " + nodeId);
          }
          return mapProvisionedNode(rs);
        }
      }
    });
  }

  public void revokeNode(String nodeId) {
    executeInTransaction(conn -> {
      Long deviceId = null;
      try (PreparedStatement select = conn.prepareStatement("SELECT device_id FROM core.sync_nodes WHERE id = ?")) {
        select.setString(1, nodeId);
        try (ResultSet rs = select.executeQuery()) {
          if (!rs.next()) {
            throw com.fern.common.middleware.ServiceException.notFound("Sync node not found: " + nodeId);
          }
          long value = rs.getLong(1);
          deviceId = rs.wasNull() ? null : value;
        }
      }
      try (PreparedStatement update = conn.prepareStatement(
          """
          UPDATE core.sync_nodes
          SET status = 'REVOKED',
              updated_at = ?
          WHERE id = ?
          """
      )) {
        update.setTimestamp(1, Timestamp.from(clock.instant()));
        update.setString(2, nodeId);
        update.executeUpdate();
      }
      if (deviceId != null) {
        try (PreparedStatement revokeDevice = conn.prepareStatement(
            "UPDATE core.device_registry SET revoked_at = ? WHERE id = ?"
        )) {
          revokeDevice.setTimestamp(1, Timestamp.from(clock.instant()));
          revokeDevice.setLong(2, deviceId);
          revokeDevice.executeUpdate();
        }
      }
      return null;
    });
  }

  public void registerNodeDeviceToken(
      long deviceId,
      long storeId,
      String deviceLabel,
      int workerId,
      String tokenHash,
      Instant tokenExpiresAt
  ) {
    execute(
        """
        INSERT INTO core.device_registry (
          id, outlet_id, device_label, worker_id, token_hash, token_expires_at, paired_at, issued_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE
        SET outlet_id = EXCLUDED.outlet_id,
            device_label = EXCLUDED.device_label,
            worker_id = EXCLUDED.worker_id,
            token_hash = EXCLUDED.token_hash,
            token_expires_at = EXCLUDED.token_expires_at,
            paired_at = EXCLUDED.paired_at,
            issued_at = EXCLUDED.issued_at,
            last_seen_at = EXCLUDED.last_seen_at,
            revoked_at = NULL
        """,
        deviceId,
        storeId,
        deviceLabel,
        workerId,
        tokenHash,
        Timestamp.from(tokenExpiresAt),
        Timestamp.from(clock.instant()),
        Timestamp.from(clock.instant()),
        Timestamp.from(clock.instant())
    );
  }

  public UploadInsertResult insertCentralInbox(String nodeId, long storeId, SyncDtos.SyncEvent event) {
    return executeInTransaction(conn -> {
      if (centralInboxExists(conn, event.eventId())) {
        touchNodeUpload(conn, nodeId, storeId);
        return UploadInsertResult.DUPLICATED;
      }
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.central_inbox (
            event_id, source_node_id, source_store_id, event_type, aggregate_type,
            aggregate_id, payload_json, version, status, received_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?, 'ACCEPTED', ?)
          """
      )) {
        ps.setString(1, event.eventId());
        ps.setString(2, nodeId);
        ps.setLong(3, storeId);
        ps.setString(4, event.eventType().name());
        ps.setString(5, event.aggregateType().name());
        ps.setString(6, event.aggregateId());
        ps.setString(7, objectMapper.writeValueAsString(event.payload()));
        ps.setLong(8, event.version());
        ps.setTimestamp(9, Timestamp.from(clock.instant()));
        ps.executeUpdate();
      }
      touchNodeUpload(conn, nodeId, storeId);
      return UploadInsertResult.ACCEPTED;
    });
  }

  public List<CentralOutboxRow> findDownloadEvents(long storeId, long cursor, int limit) {
    return queryList(
        """
        SELECT id, event_type, aggregate_type, aggregate_id, payload_json, version, created_at
        FROM core.central_outbox
        WHERE id > ?
          AND status IN ('PENDING', 'PUBLISHED')
          AND (
            target_scope = 'ALL_STORES'
            OR (target_scope = 'STORE' AND target_store_id = ?)
          )
        ORDER BY id ASC
        LIMIT ?
        """,
        this::mapCentralOutboxRow,
        cursor,
        storeId,
        limit
    );
  }

  public void ack(String nodeId, long storeId, List<SyncDtos.SyncAckItem> events) {
    executeInTransaction(conn -> {
      for (SyncDtos.SyncAckItem event : events) {
        try (PreparedStatement ps = conn.prepareStatement(
            """
            INSERT INTO core.sync_event_acks (
              event_id, node_id, store_id, status, error_message, acked_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (event_id, node_id) DO UPDATE
            SET status = EXCLUDED.status,
                error_message = EXCLUDED.error_message,
                acked_at = EXCLUDED.acked_at
            """
        )) {
          ps.setString(1, event.eventId());
          ps.setString(2, nodeId);
          ps.setLong(3, storeId);
          ps.setString(4, event.status().name());
          ps.setString(5, event.errorMessage());
          ps.setTimestamp(6, Timestamp.from(clock.instant()));
          ps.executeUpdate();
        }
      }
      touchNodeDownload(conn, nodeId, storeId);
      return null;
    });
  }

  public SyncDtos.SyncStatusResponse status(long storeId) {
    return queryOne(
        """
        SELECT
          n.store_id,
          MAX(n.last_upload_at) AS last_upload_at,
          MAX(n.last_download_at) AS last_download_at,
          MAX(n.last_seen_at) AS last_seen_at,
          COALESCE((SELECT COUNT(*) FROM core.central_inbox ci
                    WHERE ci.source_store_id = n.store_id AND ci.status IN ('ACCEPTED','PENDING')), 0) AS pending_upload_count,
          COALESCE((SELECT COUNT(*) FROM core.central_outbox co
                    WHERE co.status IN ('PENDING','PUBLISHED')
                      AND (co.target_scope = 'ALL_STORES'
                           OR (co.target_scope = 'STORE' AND co.target_store_id = n.store_id))), 0) AS pending_download_count,
          COALESCE((SELECT COUNT(*) FROM core.central_inbox ci
                    WHERE ci.source_store_id = n.store_id AND ci.status IN ('FAILED','REJECTED')), 0) AS failed_event_count
        FROM core.sync_nodes n
        WHERE n.store_id = ?
        GROUP BY n.store_id
        """,
        rs -> new SyncDtos.SyncStatusResponse(
            rsLong(rs, "store_id"),
            instant(rs, "last_upload_at"),
            instant(rs, "last_download_at"),
            rsLong(rs, "pending_upload_count"),
            rsLong(rs, "pending_download_count"),
            rsLong(rs, "failed_event_count"),
            instant(rs, "last_seen_at")
        ),
        storeId
    ).orElse(new SyncDtos.SyncStatusResponse(storeId, null, null, 0, 0, 0, null));
  }

  public long appendCentralOutbox(
      EventType eventType,
      AggregateType aggregateType,
      String aggregateId,
      JsonNode payload,
      TargetScope targetScope,
      Long targetStoreId,
      Long targetStoreGroupId,
      long version
  ) {
    return executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.central_outbox (
            event_type, aggregate_type, aggregate_id, target_scope, target_store_id,
            target_store_group_id, payload_json, version, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?, 'PENDING', ?)
          RETURNING id
          """
      )) {
        ps.setString(1, eventType.name());
        ps.setString(2, aggregateType.name());
        ps.setString(3, aggregateId);
        ps.setString(4, targetScope.name());
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
        ps.setString(7, objectMapper.writeValueAsString(payload));
        ps.setLong(8, version);
        ps.setTimestamp(9, Timestamp.from(clock.instant()));
        try (ResultSet rs = ps.executeQuery()) {
          rs.next();
          return rs.getLong("id");
        }
      }
    });
  }

  public boolean localVersionIsNewer(String aggregateType, String aggregateId, long incomingVersion) {
    return queryOne(
        """
        SELECT version
        FROM core.local_applied_versions
        WHERE aggregate_type = ? AND aggregate_id = ?
        """,
        rs -> rsLong(rs, "version"),
        aggregateType,
        aggregateId
    ).map(version -> incomingVersion > version).orElse(true);
  }

  public void recordAppliedVersion(String aggregateType, String aggregateId, long version) {
    execute(
        """
        INSERT INTO core.local_applied_versions (aggregate_type, aggregate_id, version, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (aggregate_type, aggregate_id) DO UPDATE
        SET version = GREATEST(core.local_applied_versions.version, EXCLUDED.version),
            updated_at = EXCLUDED.updated_at
        """,
        aggregateType,
        aggregateId,
        version,
        Timestamp.from(clock.instant())
    );
  }

  public void recordConflict(SyncDtos.SyncEvent event, String conflictType, String errorMessage) {
    execute(
        """
        INSERT INTO core.sync_conflicts (
          event_id, aggregate_type, aggregate_id, conflict_type, resolution,
          remote_version, payload_json, status, error_message, created_at
        ) VALUES (?, ?, ?, ?, 'MANUAL_REVIEW', ?, ?::jsonb, 'OPEN', ?, ?)
        """,
        event.eventId(),
        event.aggregateType().name(),
        event.aggregateId(),
        conflictType,
        event.version(),
        toJson(event.payload()),
        errorMessage,
        Timestamp.from(clock.instant())
    );
  }

  public List<LocalOutboxRow> claimPendingLocalOutbox(int limit) {
    return queryList(
        """
        SELECT id, event_type, aggregate_type, aggregate_id, payload_json, retry_count
        FROM core.sync_outbox
        WHERE status IN ('PENDING','FAILED')
        ORDER BY created_at ASC
        LIMIT ?
        """,
        rs -> new LocalOutboxRow(
            text(rs, "id"),
            text(rs, "event_type"),
            text(rs, "aggregate_type"),
            text(rs, "aggregate_id"),
            readJson(rs, "payload_json"),
            rsInt(rs, "retry_count")
        ),
        limit
    );
  }

  public void markLocalOutboxSent(List<String> eventIds) {
    if (eventIds == null || eventIds.isEmpty()) {
      return;
    }
    executeInTransaction(conn -> {
      for (String eventId : eventIds) {
        try (PreparedStatement ps = conn.prepareStatement(
            "UPDATE core.sync_outbox SET status = 'SENT', sent_at = ? WHERE id = ?"
        )) {
          ps.setTimestamp(1, Timestamp.from(clock.instant()));
          ps.setString(2, eventId);
          ps.executeUpdate();
        }
      }
      return null;
    });
  }

  public void markLocalOutboxFailed(List<String> eventIds, String errorMessage) {
    if (eventIds == null || eventIds.isEmpty()) {
      return;
    }
    executeInTransaction(conn -> {
      for (String eventId : eventIds) {
        try (PreparedStatement ps = conn.prepareStatement(
            """
            UPDATE core.sync_outbox
            SET status = 'FAILED',
                retry_count = retry_count + 1,
                last_error = ?
            WHERE id = ?
            """
        )) {
          ps.setString(1, errorMessage);
          ps.setString(2, eventId);
          ps.executeUpdate();
        }
      }
      return null;
    });
  }

  private boolean centralInboxExists(Connection conn, String eventId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement("SELECT 1 FROM core.central_inbox WHERE event_id = ?")) {
      ps.setString(1, eventId);
      try (ResultSet rs = ps.executeQuery()) {
        return rs.next();
      }
    }
  }

  private void touchNodeUpload(Connection conn, String nodeId, long storeId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        UPDATE core.sync_nodes
        SET last_seen_at = ?, last_upload_at = ?, updated_at = ?
        WHERE id = ? AND store_id = ?
        """
    )) {
      Timestamp now = Timestamp.from(clock.instant());
      ps.setTimestamp(1, now);
      ps.setTimestamp(2, now);
      ps.setTimestamp(3, now);
      ps.setString(4, nodeId);
      ps.setLong(5, storeId);
      ps.executeUpdate();
    }
  }

  private void touchNodeDownload(Connection conn, String nodeId, long storeId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        UPDATE core.sync_nodes
        SET last_seen_at = ?, last_download_at = ?, updated_at = ?
        WHERE id = ? AND store_id = ?
        """
    )) {
      Timestamp now = Timestamp.from(clock.instant());
      ps.setTimestamp(1, now);
      ps.setTimestamp(2, now);
      ps.setTimestamp(3, now);
      ps.setString(4, nodeId);
      ps.setLong(5, storeId);
      ps.executeUpdate();
    }
  }

  private CentralOutboxRow mapCentralOutboxRow(ResultSet rs) {
    return new CentralOutboxRow(
        rsLong(rs, "id"),
        EventType.valueOf(text(rs, "event_type")),
        AggregateType.valueOf(text(rs, "aggregate_type")),
        text(rs, "aggregate_id"),
        readJson(rs, "payload_json"),
        rsLong(rs, "version"),
        instant(rs, "created_at")
    );
  }

  private ProvisionedNodeRow mapProvisionedNode(ResultSet rs) {
    return new ProvisionedNodeRow(
        text(rs, "id"),
        rsLong(rs, "store_id"),
        text(rs, "node_code"),
        text(rs, "node_name"),
        rsLong(rs, "device_id"),
        rsInt(rs, "worker_id"),
        text(rs, "client_secret_hash")
    );
  }

  private JsonNode readJson(ResultSet rs, String column) {
    try {
      return objectMapper.readTree(rs.getString(column));
    } catch (Exception e) {
      throw new IllegalStateException("Invalid JSON in " + column, e);
    }
  }

  private String toJson(JsonNode payload) {
    try {
      return objectMapper.writeValueAsString(payload);
    } catch (Exception e) {
      throw new IllegalStateException("Invalid JSON payload", e);
    }
  }

  private static String text(ResultSet rs, String column) {
    try {
      return rs.getString(column);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  private static long rsLong(ResultSet rs, String column) {
    try {
      return rs.getLong(column);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  private static int rsInt(ResultSet rs, String column) {
    try {
      return rs.getInt(column);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  private static Instant instant(ResultSet rs, String column) {
    try {
      Timestamp timestamp = rs.getTimestamp(column);
      return timestamp == null ? null : timestamp.toInstant();
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  public enum UploadInsertResult {
    ACCEPTED,
    DUPLICATED
  }

  public record SyncNodeRow(String id, long storeId, String nodeCode, String status) {
  }

  public record ProvisionedNodeRow(
      String id,
      long storeId,
      String nodeCode,
      String nodeName,
      long deviceId,
      int workerId,
      String clientSecretHash
  ) {
  }

  public record CentralOutboxRow(
      long id,
      EventType eventType,
      AggregateType aggregateType,
      String aggregateId,
      JsonNode payload,
      long version,
      Instant createdAt
  ) {
  }

  public record LocalOutboxRow(
      String id,
      String eventType,
      String aggregateType,
      String aggregateId,
      JsonNode payload,
      int retryCount
  ) {
  }
}
