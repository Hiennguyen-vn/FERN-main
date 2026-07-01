package com.fern.services.sync.state;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fern.common.repository.BaseRepository;
import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.model.AggregateType;
import com.fern.services.sync.model.EventType;
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
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Repository;

@Repository
@Primary
public class SyncRepository extends BaseRepository
    implements DownstreamFeedStore, DownstreamInboxStore, NodeTopologyStore, RegionalRelayStateStore {

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

  @Override
  public Optional<NodeTopology> findNodeTopology(String nodeId) {
    return queryOne(
        """
        SELECT id, store_id, parent_node_id, managed_scope_type, managed_scope_id, runtime_role, status
        FROM core.sync_nodes
        WHERE id = ?
        """,
        rs -> new NodeTopology(
            text(rs, "id"),
            rsLong(rs, "store_id"),
            text(rs, "parent_node_id"),
            text(rs, "managed_scope_type"),
            nullableLong(rs, "managed_scope_id"),
            text(rs, "runtime_role"),
            text(rs, "status")
        ),
        nodeId
    );
  }

  @Override
  public Optional<NodeTopology> findManagedChild(String parentNodeId, long storeId) {
    return queryOne(
        """
        SELECT id, store_id, parent_node_id, managed_scope_type, managed_scope_id, runtime_role, status
        FROM core.sync_nodes
        WHERE parent_node_id = ? AND store_id = ?
        """,
        rs -> new NodeTopology(
            text(rs, "id"),
            rsLong(rs, "store_id"),
            text(rs, "parent_node_id"),
            text(rs, "managed_scope_type"),
            nullableLong(rs, "managed_scope_id"),
            text(rs, "runtime_role"),
            text(rs, "status")
        ),
        parentNodeId,
        storeId
    );
  }

  @Override
  public List<NodeTopology> listManagedChildren(String parentNodeId) {
    return queryList(
        """
        SELECT id, store_id, parent_node_id, managed_scope_type, managed_scope_id, runtime_role, status
        FROM core.sync_nodes
        WHERE parent_node_id = ? AND status = 'ACTIVE'
        ORDER BY store_id ASC, id ASC
        """,
        rs -> new NodeTopology(
            text(rs, "id"),
            rsLong(rs, "store_id"),
            text(rs, "parent_node_id"),
            text(rs, "managed_scope_type"),
            nullableLong(rs, "managed_scope_id"),
            text(rs, "runtime_role"),
            text(rs, "status")
        ),
        parentNodeId
    );
  }

  @Override
  public List<NodeTopology> listManagedChildrenByStoreIds(String parentNodeId, List<Long> storeIds) {
    if (storeIds == null || storeIds.isEmpty()) {
      return List.of();
    }
    String placeholders = String.join(", ", java.util.Collections.nCopies(storeIds.size(), "?"));
    List<Object> params = new ArrayList<>();
    params.add(parentNodeId);
    params.addAll(storeIds);
    return queryList(
        """
        SELECT id, store_id, parent_node_id, managed_scope_type, managed_scope_id, runtime_role, status
        FROM core.sync_nodes
        WHERE parent_node_id = ?
          AND status = 'ACTIVE'
          AND store_id IN (""" + placeholders + ") ORDER BY store_id ASC, id ASC",
        rs -> new NodeTopology(
            text(rs, "id"),
            rsLong(rs, "store_id"),
            text(rs, "parent_node_id"),
            text(rs, "managed_scope_type"),
            nullableLong(rs, "managed_scope_id"),
            text(rs, "runtime_role"),
            text(rs, "status")
        ),
        params.toArray()
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

  public void assignNodeToParent(String nodeId, String parentNodeId, String runtimeRole) {
    execute(
        """
        UPDATE core.sync_nodes
        SET parent_node_id = ?,
            runtime_role = ?,
            managed_scope_type = 'STORE',
            managed_scope_id = store_id,
            updated_at = ?
        WHERE id = ?
        """,
        parentNodeId,
        runtimeRole,
        Timestamp.from(clock.instant()),
        nodeId
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

  @Override
  public IngestResult insertDownstreamInbox(String nodeId, Long storeId, SyncDtos.SyncEvent event) {
    return executeInTransaction(conn -> {
      if (downstreamInboxExists(conn, event.eventId())) {
        return IngestResult.DUPLICATED;
      }
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.downstream_inbox (
            event_id, source_node_id, source_store_id, event_type, aggregate_type,
            aggregate_id, payload_json, version, status, received_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?, 'ACCEPTED', ?)
          """
      )) {
        ps.setString(1, event.eventId());
        ps.setString(2, nodeId);
        if (storeId == null) {
          ps.setNull(3, java.sql.Types.BIGINT);
        } else {
          ps.setLong(3, storeId);
        }
        ps.setString(4, event.eventType().name());
        ps.setString(5, event.aggregateType().name());
        ps.setString(6, event.aggregateId());
        ps.setString(7, objectMapper.writeValueAsString(event.payload()));
        ps.setLong(8, event.version());
        ps.setTimestamp(9, Timestamp.from(clock.instant()));
        ps.executeUpdate();
      }
      return IngestResult.ACCEPTED;
    });
  }

  @Override
  public void enqueueAcceptedRelayCandidate(String nodeId, long storeId, SyncDtos.SyncEvent event) {
    execute(
        """
        UPDATE core.downstream_inbox
        SET status = 'PENDING',
            error_message = NULL,
            claimed_at = NULL,
            next_attempt_at = ?,
            retry_count = 0
        WHERE event_id = ? AND source_node_id = ? AND source_store_id = ?
        """,
        Timestamp.from(clock.instant()),
        event.eventId(),
        nodeId,
        storeId
    );
  }

  @Override
  public List<PendingRelayEvent> claimPendingRelayEvents(int limit) {
    return executeInTransaction(conn -> {
      List<PendingRelayEvent> claimed = new ArrayList<>();
      try (PreparedStatement ps = conn.prepareStatement(
          """
          WITH candidates AS (
            SELECT event_id
            FROM core.downstream_inbox
            WHERE status IN ('PENDING', 'FAILED')
              AND next_attempt_at <= ?
            ORDER BY received_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT ?
          )
          UPDATE core.downstream_inbox di
          SET status = 'APPLIED'
          FROM candidates
          WHERE di.event_id = candidates.event_id
          RETURNING di.event_id, di.source_node_id, di.source_store_id, di.event_type,
                    di.aggregate_type, di.aggregate_id, di.payload_json, di.version, di.received_at, di.retry_count
          """
      )) {
        Timestamp now = Timestamp.from(clock.instant());
        ps.setTimestamp(1, now);
        ps.setInt(2, limit);
        try (ResultSet rs = ps.executeQuery()) {
          while (rs.next()) {
            claimed.add(new PendingRelayEvent(
                text(rs, "event_id"),
                text(rs, "source_node_id"),
                rsLong(rs, "source_store_id"),
                text(rs, "event_type"),
                text(rs, "aggregate_type"),
                text(rs, "aggregate_id"),
                readJson(rs, "payload_json"),
                rsLong(rs, "version"),
                instant(rs, "received_at"),
                rsInt(rs, "retry_count")
            ));
          }
        }
      }
      return claimed;
    });
  }

  @Override
  public void markRelaySent(List<String> relayIds) {
    if (relayIds == null || relayIds.isEmpty()) {
      return;
    }
    executeInTransaction(conn -> {
      for (String relayId : relayIds) {
        try (PreparedStatement ps = conn.prepareStatement(
            """
            UPDATE core.downstream_inbox
            SET status = 'APPLIED',
                applied_at = ?,
                error_message = NULL,
                claimed_at = NULL
            WHERE event_id = ?
            """
        )) {
          ps.setTimestamp(1, Timestamp.from(clock.instant()));
          ps.setString(2, relayId);
          ps.executeUpdate();
        }
      }
      return null;
    });
  }

  @Override
  public void markRelayFailed(List<String> relayIds, String errorMessage) {
    if (relayIds == null || relayIds.isEmpty()) {
      return;
    }
    executeInTransaction(conn -> {
      for (String relayId : relayIds) {
        try (PreparedStatement ps = conn.prepareStatement(
            """
            UPDATE core.downstream_inbox
            SET status = 'FAILED',
                error_message = ?,
                retry_count = retry_count + 1,
                claimed_at = NULL,
                next_attempt_at = ?
            WHERE event_id = ?
            """
        )) {
          ps.setString(1, errorMessage);
          ps.setTimestamp(2, Timestamp.from(nextRelayAttemptAt(relayId)));
          ps.setString(3, relayId);
          ps.executeUpdate();
        }
      }
      return null;
    });
  }

  private Instant nextRelayAttemptAt(String relayId) {
    int retryCount = queryOne(
        "SELECT retry_count FROM core.downstream_inbox WHERE event_id = ?",
        rs -> rsInt(rs, "retry_count"),
        relayId
    ).orElse(0);
    long delaySeconds = Math.min(300L, Math.max(5L, (long) Math.pow(2, Math.min(retryCount, 6)) * 5L));
    return clock.instant().plusSeconds(delaySeconds);
  }

  public List<CentralOutboxRow> findDownloadEvents(long storeId, long cursor, int limit) {
    return queryList(
        """
        SELECT id, event_type, aggregate_type, aggregate_id, payload_json, version, created_at,
               target_scope, target_store_id, target_store_group_id
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
            instant(rs, "last_seen_at"),
            0,
            0,
            null,
            null
        ),
        storeId
    ).orElse(new SyncDtos.SyncStatusResponse(storeId, null, null, 0, 0, 0, null, 0, 0, null, null));
  }

  public SyncDtos.SyncStatusResponse hubStatus(long storeId) {
    return queryOne(
        """
        SELECT
          n.store_id,
          MAX(n.last_upload_at) AS last_upload_at,
          MAX(n.last_download_at) AS last_download_at,
          MAX(n.last_seen_at) AS last_seen_at,
          COALESCE((SELECT COUNT(*) FROM core.downstream_inbox di
                    WHERE di.source_store_id = n.store_id AND di.status IN ('ACCEPTED','PENDING')), 0) AS pending_upload_count,
          COALESCE((SELECT COUNT(*) FROM core.downstream_outbox dout
                    WHERE dout.status IN ('PENDING','PUBLISHED')
                      AND (dout.target_scope = 'ALL_STORES'
                           OR (dout.target_scope = 'STORE' AND dout.target_store_id = n.store_id))), 0) AS pending_download_count,
          COALESCE((SELECT COUNT(*) FROM core.downstream_inbox di
                    WHERE di.source_store_id = n.store_id AND di.status IN ('FAILED','REJECTED')), 0)
            + COALESCE((SELECT COUNT(*) FROM core.downstream_event_acks da
                        WHERE da.store_id = n.store_id AND da.status IN ('FAILED','REJECTED')), 0) AS failed_event_count,
          COALESCE((SELECT COUNT(*) FROM core.downstream_inbox di
                    WHERE di.source_store_id = n.store_id AND di.status IN ('PENDING','FAILED')), 0) AS pending_relay_count,
          COALESCE((SELECT COUNT(*) FROM core.downstream_inbox di
                    WHERE di.source_store_id = n.store_id AND di.status = 'FAILED'), 0) AS failed_relay_count,
          (SELECT MAX(sl.started_at) FROM core.sync_logs sl
            WHERE sl.direction = 'REGION_TO_CENTRAL') AS last_relay_attempt_at,
          (SELECT MAX(sl.finished_at) FROM core.sync_logs sl
            WHERE sl.direction = 'REGION_TO_CENTRAL' AND sl.status = 'SENT') AS last_relay_success_at
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
            instant(rs, "last_seen_at"),
            rsLong(rs, "pending_relay_count"),
            rsLong(rs, "failed_relay_count"),
            instant(rs, "last_relay_attempt_at"),
            instant(rs, "last_relay_success_at")
        ),
        storeId
    ).orElse(new SyncDtos.SyncStatusResponse(storeId, null, null, 0, 0, 0, null, 0, 0, null, null));
  }

  public HubOverviewRow hubOverview(String hubNodeId) {
    return queryOne(
        """
        SELECT
          COALESCE((SELECT COUNT(*) FROM core.sync_nodes sn
                    WHERE sn.parent_node_id = ? AND sn.status = 'ACTIVE'), 0) AS managed_child_count,
          COALESCE((SELECT COUNT(*) FROM core.sync_nodes sn
                    WHERE sn.parent_node_id = ? AND sn.status = 'REVOKED'), 0) AS revoked_child_count,
          COALESCE((SELECT COUNT(*) FROM core.downstream_outbox dout
                    WHERE dout.source_node_id = ? AND dout.status IN ('PENDING','PUBLISHED')), 0) AS pending_forwarding_count,
          COALESCE((SELECT COUNT(*) FROM core.downstream_inbox din
                    WHERE din.status IN ('PENDING','FAILED')), 0) AS pending_relay_count,
          (SELECT MAX(sl.finished_at) FROM core.sync_logs sl
            WHERE sl.node_id = ? AND sl.direction = 'CENTRAL_TO_REGION' AND sl.status = 'SENT') AS last_forwarding_success_at,
          (SELECT MAX(sl.finished_at) FROM core.sync_logs sl
            WHERE sl.node_id = ? AND sl.direction = 'REGION_TO_CENTRAL' AND sl.status = 'SENT') AS last_relay_success_at
        """,
        rs -> new HubOverviewRow(
            rsLong(rs, "managed_child_count"),
            rsLong(rs, "revoked_child_count"),
            rsLong(rs, "pending_forwarding_count"),
            rsLong(rs, "pending_relay_count"),
            instant(rs, "last_forwarding_success_at"),
            instant(rs, "last_relay_success_at")
        ),
        hubNodeId,
        hubNodeId,
        hubNodeId,
        hubNodeId,
        hubNodeId
    ).orElse(new HubOverviewRow(0, 0, 0, 0, null, null));
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

  @Override
  public long appendDownstreamEvent(
      String sourceNodeId,
      String eventType,
      String aggregateType,
      String aggregateId,
      String targetScope,
      Long targetStoreId,
      Long targetStoreGroupId,
      String targetNodeId,
      JsonNode payload,
      long version
  ) {
    return executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.downstream_outbox (
            source_node_id, event_type, aggregate_type, aggregate_id,
            target_scope, target_store_id, target_store_group_id, target_node_id,
            payload_json, version, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, 'PENDING', ?)
          RETURNING id
          """
      )) {
        ps.setString(1, sourceNodeId);
        ps.setString(2, eventType);
        ps.setString(3, aggregateType);
        ps.setString(4, aggregateId);
        ps.setString(5, targetScope);
        if (targetStoreId == null) {
          ps.setNull(6, java.sql.Types.BIGINT);
        } else {
          ps.setLong(6, targetStoreId);
        }
        if (targetStoreGroupId == null) {
          ps.setNull(7, java.sql.Types.BIGINT);
        } else {
          ps.setLong(7, targetStoreGroupId);
        }
        ps.setString(8, targetNodeId);
        ps.setString(9, objectMapper.writeValueAsString(payload));
        ps.setLong(10, version);
        ps.setTimestamp(11, Timestamp.from(clock.instant()));
        try (ResultSet rs = ps.executeQuery()) {
          rs.next();
          return rs.getLong("id");
        }
      }
    });
  }

  @Override
  public List<DownstreamEvent> readDownstreamEvents(String targetNodeId, Long targetStoreId, long cursor, int limit) {
    return queryList(
        """
        SELECT id, event_type, aggregate_type, aggregate_id, payload_json, version, created_at,
               target_scope, target_store_id, target_store_group_id
        FROM core.downstream_outbox
        WHERE id > ?
          AND status IN ('PENDING', 'PUBLISHED')
          AND (
            target_scope = 'ALL_STORES'
            OR (target_scope = 'STORE' AND target_store_id = ?)
            OR (target_scope = 'NODE' AND target_node_id = ?)
          )
        ORDER BY id ASC
        LIMIT ?
        """,
        rs -> new DownstreamEvent(
            rsLong(rs, "id"),
            text(rs, "event_type"),
            text(rs, "aggregate_type"),
            text(rs, "aggregate_id"),
            readJson(rs, "payload_json"),
            rsLong(rs, "version"),
            instant(rs, "created_at"),
            text(rs, "target_scope"),
            nullableLong(rs, "target_store_id"),
            nullableLong(rs, "target_store_group_id")
        ),
        cursor,
        targetStoreId,
        targetNodeId,
        limit
    );
  }

  @Override
  public void recordDownstreamAck(String eventId, String nodeId, Long storeId, String status, String errorMessage) {
    execute(
        """
        INSERT INTO core.downstream_event_acks (
          event_id, node_id, store_id, status, error_message, acked_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (event_id, node_id) DO UPDATE
        SET status = EXCLUDED.status,
            error_message = EXCLUDED.error_message,
            acked_at = EXCLUDED.acked_at
        """,
        eventId,
        nodeId,
        storeId,
        status,
        errorMessage,
        Timestamp.from(clock.instant())
    );
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

  public String readSyncOffset(String nodeId, String streamName) {
    return queryOne(
        """
        SELECT last_cursor
        FROM core.sync_offsets
        WHERE node_id = ? AND stream_name = ?
        """,
        rs -> text(rs, "last_cursor"),
        nodeId,
        streamName
    ).orElse("0");
  }

  public void saveSyncOffset(String nodeId, String streamName, String cursor) {
    execute(
        """
        INSERT INTO core.sync_offsets (node_id, stream_name, last_cursor, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (node_id, stream_name) DO UPDATE
        SET last_cursor = EXCLUDED.last_cursor,
            updated_at = EXCLUDED.updated_at
        """,
        nodeId,
        streamName,
        cursor,
        Timestamp.from(clock.instant())
    );
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
    return executeInTransaction(conn -> {
      List<LocalOutboxRow> claimed = new ArrayList<>();
      try (PreparedStatement ps = conn.prepareStatement(
          """
          WITH candidates AS (
            SELECT id
            FROM core.sync_outbox
            WHERE status IN ('PENDING','FAILED')
              AND next_attempt_at <= ?
            ORDER BY created_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT ?
          )
          UPDATE core.sync_outbox so
          SET status = 'IN_FLIGHT',
              claimed_at = ?
          FROM candidates
          WHERE so.id = candidates.id
          RETURNING so.id, so.event_type, so.aggregate_type, so.aggregate_id, so.payload_json, so.retry_count
          """
      )) {
        Timestamp now = Timestamp.from(clock.instant());
        ps.setTimestamp(1, now);
        ps.setInt(2, limit);
        ps.setTimestamp(3, now);
        try (ResultSet rs = ps.executeQuery()) {
          while (rs.next()) {
            claimed.add(new LocalOutboxRow(
                text(rs, "id"),
                text(rs, "event_type"),
                text(rs, "aggregate_type"),
                text(rs, "aggregate_id"),
                readJson(rs, "payload_json"),
                rsInt(rs, "retry_count")
            ));
          }
        }
      }
      return claimed;
    });
  }

  public void markLocalOutboxSent(List<String> eventIds) {
    if (eventIds == null || eventIds.isEmpty()) {
      return;
    }
    executeInTransaction(conn -> {
      for (String eventId : eventIds) {
        try (PreparedStatement ps = conn.prepareStatement(
            "UPDATE core.sync_outbox SET status = 'SENT', sent_at = ?, claimed_at = NULL WHERE id = ?"
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
                last_error = ?,
                claimed_at = NULL,
                next_attempt_at = ?,
                sent_at = NULL
            WHERE id = ?
            """
        )) {
          ps.setString(1, errorMessage);
          ps.setTimestamp(2, Timestamp.from(nextAttemptAt(eventId)));
          ps.setString(3, eventId);
          ps.executeUpdate();
        }
      }
      return null;
    });
  }

  public long openSyncLog(String nodeId, long storeId, String direction, String status, String message) {
    return executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.sync_logs (
            node_id, store_id, direction, status, event_count, message, started_at
          ) VALUES (?, ?, ?, ?, 0, ?, ?)
          RETURNING id
          """
      )) {
        ps.setString(1, nodeId);
        ps.setLong(2, storeId);
        ps.setString(3, direction);
        ps.setString(4, status);
        ps.setString(5, message);
        ps.setTimestamp(6, Timestamp.from(clock.instant()));
        try (ResultSet rs = ps.executeQuery()) {
          rs.next();
          return rs.getLong("id");
        }
      }
    });
  }

  public void finishSyncLog(long logId, String status, int eventCount, String message) {
    execute(
        """
        UPDATE core.sync_logs
        SET status = ?,
            event_count = ?,
            message = ?,
            finished_at = ?
        WHERE id = ?
        """,
        status,
        eventCount,
        message,
        Timestamp.from(clock.instant()),
        logId
    );
  }

  private boolean centralInboxExists(Connection conn, String eventId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement("SELECT 1 FROM core.central_inbox WHERE event_id = ?")) {
      ps.setString(1, eventId);
      try (ResultSet rs = ps.executeQuery()) {
        return rs.next();
      }
    }
  }

  private boolean downstreamInboxExists(Connection conn, String eventId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement("SELECT 1 FROM core.downstream_inbox WHERE event_id = ?")) {
      ps.setString(1, eventId);
      try (ResultSet rs = ps.executeQuery()) {
        return rs.next();
      }
    }
  }

  private Instant nextAttemptAt(String eventId) {
    int retryCount = queryOne(
        "SELECT retry_count FROM core.sync_outbox WHERE id = ?",
        rs -> rsInt(rs, "retry_count"),
        eventId
    ).orElse(0);
    long delaySeconds = Math.min(300L, Math.max(5L, (long) Math.pow(2, Math.min(retryCount, 6)) * 5L));
    return clock.instant().plusSeconds(delaySeconds);
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
        instant(rs, "created_at"),
        text(rs, "target_scope"),
        nullableLong(rs, "target_store_id"),
        nullableLong(rs, "target_store_group_id")
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

  private static Long nullableLong(ResultSet rs, String column) {
    try {
      long value = rs.getLong(column);
      return rs.wasNull() ? null : value;
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
      Instant createdAt,
      String targetScope,
      Long targetStoreId,
      Long targetStoreGroupId
  ) {
  }

  public record HubOverviewRow(
      long managedChildCount,
      long revokedChildCount,
      long pendingForwardingCount,
      long pendingRelayCount,
      Instant lastForwardingSuccessAt,
      Instant lastRelaySuccessAt
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
