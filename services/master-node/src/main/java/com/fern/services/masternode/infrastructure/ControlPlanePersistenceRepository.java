package com.fern.services.masternode.infrastructure;

import com.dorabets.common.repository.BaseRepository;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fern.services.masternode.api.ControlPlaneDtos;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;
import javax.sql.DataSource;
import org.springframework.stereotype.Repository;

@Repository
public class ControlPlanePersistenceRepository extends BaseRepository {

  private final ObjectMapper objectMapper;
  private final SnowflakeIdGenerator idGenerator;

  public ControlPlanePersistenceRepository(
      DataSource dataSource,
      ObjectMapper objectMapper,
      SnowflakeIdGenerator idGenerator
  ) {
    super(dataSource);
    this.objectMapper = objectMapper;
    this.idGenerator = idGenerator;
  }

  public long ensureDefaultConfig(String serviceName, Instant now) {
    Optional<Long> existing = queryOne(
        """
        SELECT config_version
        FROM core.service_config_profile
        WHERE service_name = ? AND active = TRUE
        """,
        rs -> getLong(rs, "config_version"),
        serviceName
    );
    if (existing.isPresent()) {
      return existing.get();
    }
    long id = idGenerator.generateId();
    execute(
        """
        INSERT INTO core.service_config_profile (
          id, service_name, config_version, etag, properties, active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?::jsonb, TRUE, ?, ?)
        """,
        id,
        serviceName,
        1L,
        serviceName + "-v1",
        "{}",
        timestamp(now),
        timestamp(now)
    );
    return 1L;
  }

  public long upsertInstance(
      long instanceId,
      ControlPlaneDtos.ServiceRegistrationRequest request,
      Instant now,
      String status
  ) {
    String metadataJson = toJson(request.metadata());
    return executeInTransaction(connection -> {
      Long existingInstanceId = findExistingInstanceId(connection, request.serviceName(), request.host(), request.port());
      long effectiveInstanceId = existingInstanceId != null ? existingInstanceId : instanceId;

      try (PreparedStatement upsert = connection.prepareStatement(
          """
          INSERT INTO core.service_instance (
            id, service_name, version, runtime, host, port, status, first_registered_at,
            last_heartbeat_at, metadata, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?)
          ON CONFLICT (service_name, host, port) DO UPDATE SET
            version = EXCLUDED.version,
            runtime = EXCLUDED.runtime,
            status = EXCLUDED.status,
            last_heartbeat_at = EXCLUDED.last_heartbeat_at,
            metadata = EXCLUDED.metadata,
            updated_at = EXCLUDED.updated_at
          """
      )) {
        upsert.setLong(1, effectiveInstanceId);
        upsert.setString(2, request.serviceName());
        upsert.setString(3, request.version());
        upsert.setString(4, request.runtime());
        upsert.setString(5, request.host());
        upsert.setInt(6, request.port());
        upsert.setString(7, status);
        upsert.setTimestamp(8, timestamp(now));
        upsert.setTimestamp(9, timestamp(now));
        upsert.setString(10, metadataJson);
        upsert.setTimestamp(11, timestamp(now));
        upsert.setTimestamp(12, timestamp(now));
        upsert.executeUpdate();
      }

      try (PreparedStatement delete = connection.prepareStatement(
          "DELETE FROM core.service_assignment WHERE instance_id = ?"
      )) {
        delete.setLong(1, effectiveInstanceId);
        delete.executeUpdate();
      }

      List<String> safeRegionCodes = request.regionCodes() == null || request.regionCodes().isEmpty()
          ? java.util.Collections.emptyList() : request.regionCodes();
      List<Long> safeOutletIds = request.outletIds() == null || request.outletIds().isEmpty()
          ? java.util.Collections.emptyList() : request.outletIds();
      List<String> safeCapabilities = request.capabilities() == null || request.capabilities().isEmpty()
          ? java.util.Collections.emptyList() : request.capabilities();

      try (PreparedStatement insert = connection.prepareStatement(
          """
          INSERT INTO core.service_assignment (
            id, instance_id, service_name, region_code, outlet_id, capability,
            desired_instances, routing_weight, active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 1, 100, TRUE, ?, ?)
          """
      )) {
        boolean inserted = false;
        for (String regionCode : safeRegionCodes) {
          for (Long outletId : safeOutletIds) {
            for (String capability : safeCapabilities) {
              long assignmentId = idGenerator.generateId();
              insert.setLong(1, assignmentId);
              insert.setLong(2, effectiveInstanceId);
              insert.setString(3, request.serviceName());
              if (regionCode == null) {
                insert.setNull(4, java.sql.Types.VARCHAR);
              } else {
                insert.setString(4, regionCode);
              }
              if (outletId == null) {
                insert.setNull(5, java.sql.Types.BIGINT);
              } else {
                insert.setLong(5, outletId);
              }
              if (capability == null) {
                insert.setNull(6, java.sql.Types.VARCHAR);
              } else {
                insert.setString(6, capability);
              }
              insert.setTimestamp(7, timestamp(now));
              insert.setTimestamp(8, timestamp(now));
              insert.addBatch();
              inserted = true;
            }
          }
        }
        if (!inserted) {
          long assignmentId = idGenerator.generateId();
          insert.setLong(1, assignmentId);
          insert.setLong(2, effectiveInstanceId);
          insert.setString(3, request.serviceName());
          insert.setNull(4, java.sql.Types.VARCHAR);
          insert.setNull(5, java.sql.Types.BIGINT);
          insert.setNull(6, java.sql.Types.VARCHAR);
          insert.setTimestamp(7, timestamp(now));
          insert.setTimestamp(8, timestamp(now));
          insert.addBatch();
        }
        insert.executeBatch();
      }

      return effectiveInstanceId;
    });
  }

  private Long findExistingInstanceId(
      Connection connection,
      String serviceName,
      String host,
      int port
  ) throws java.sql.SQLException {
    try (PreparedStatement statement = connection.prepareStatement(
        """
        SELECT id
        FROM core.service_instance
        WHERE service_name = ? AND host = ? AND port = ?
        """
    )) {
      statement.setString(1, serviceName);
      statement.setString(2, host);
      statement.setInt(3, port);
      try (ResultSet rs = statement.executeQuery()) {
        if (rs.next()) {
          return rs.getLong("id");
        }
        return null;
      }
    }
  }

  public void touchInstance(long instanceId, ControlPlaneDtos.ServiceHeartbeatRequest request, Instant now) {
    execute(
        """
        UPDATE core.service_instance
        SET status = ?, last_heartbeat_at = ?, updated_at = ?
        WHERE id = ?
        """,
        defaultValue(request.status(), "UP"),
        timestamp(now),
        timestamp(now),
        instanceId
    );
  }

  public void markDeregistered(long instanceId, String reason, Instant now) {
    execute(
        """
        UPDATE core.service_instance
        SET status = 'DEREGISTERED',
            metadata = jsonb_set(
              COALESCE(metadata, '{}'::jsonb),
              '{deregisterReason}',
              to_jsonb(COALESCE(?,'shutdown')),
              true
            ),
            last_offline_at = ?,
            updated_at = ?
        WHERE id = ?
        """,
        reason,
        timestamp(now),
        timestamp(now),
        instanceId
    );
  }

  public Optional<ServiceInstanceRecord> findInstance(long instanceId) {
    return queryOne(
        """
        SELECT id, service_name, version, runtime, host, port, status,
               first_registered_at, last_heartbeat_at, last_offline_at, metadata
        FROM core.service_instance
        WHERE id = ?
        """,
        this::mapInstance,
        instanceId
    );
  }

  public List<ServiceInstanceRecord> listInstances(String serviceName) {
    return queryList(
        """
        SELECT id, service_name, version, runtime, host, port, status,
               first_registered_at, last_heartbeat_at, last_offline_at, metadata
        FROM core.service_instance
        WHERE service_name = ?
        ORDER BY id
        """,
        this::mapInstance,
        serviceName
    );
  }

  public List<ServiceInstanceRecord> listAllInstances() {
    return queryList(
        """
        SELECT id, service_name, version, runtime, host, port, status,
               first_registered_at, last_heartbeat_at, last_offline_at, metadata
        FROM core.service_instance
        ORDER BY service_name, id
        """,
        this::mapInstance
    );
  }

  public List<AssignmentRecord> listAssignments(String serviceName) {
    return queryList(
        """
        SELECT id, instance_id, service_name, region_code, outlet_id, capability,
               desired_instances, routing_weight, active
        FROM core.service_assignment
        WHERE service_name = ?
        ORDER BY id
        """,
        this::mapAssignment,
        serviceName
    );
  }

  public ControlPlaneDtos.EffectiveConfigResponse loadConfig(String serviceName) {
    ensureDefaultConfig(serviceName, Instant.now());
    ConfigProfile profile = queryOne(
        """
        SELECT config_version, etag, properties
        FROM core.service_config_profile
        WHERE service_name = ? AND active = TRUE
        """,
        rs -> new ConfigProfile(
            getLong(rs, "config_version"),
            getString(rs, "etag"),
            jsonMap(getString(rs, "properties"))
        ),
        serviceName
    ).orElseThrow(() -> new NoSuchElementException("Config profile not found for " + serviceName));

    Map<String, Boolean> featureFlags = new LinkedHashMap<>();
    queryList(
        """
        SELECT flag_key, enabled
        FROM core.feature_flag
        WHERE service_name = ?
        ORDER BY flag_key
        """,
        rs -> {
          featureFlags.put(getString(rs, "flag_key"), getBoolean(rs, "enabled"));
          return Boolean.TRUE;
        },
        serviceName
    );

    return new ControlPlaneDtos.EffectiveConfigResponse(
        serviceName,
        profile.configVersion(),
        profile.etag(),
        profile.properties(),
        Map.copyOf(featureFlags)
    );
  }

  public ControlPlaneDtos.CreateReleaseResponse createRelease(
      ControlPlaneDtos.CreateReleaseRequest request,
      Instant now
  ) {
    long releaseId = idGenerator.generateId();
    execute(
        """
        INSERT INTO core.service_release (
          id, service_name, version, image_ref, status, change_summary, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?)
        """,
        releaseId,
        request.serviceName(),
        request.version(),
        request.imageRef(),
        request.changeSummary(),
        request.createdBy(),
        timestamp(now),
        timestamp(now)
    );
    return new ControlPlaneDtos.CreateReleaseResponse(releaseId, "DRAFT");
  }

  public ControlPlaneDtos.CreateRolloutResponse createRollout(
      long releaseId,
      ControlPlaneDtos.CreateRolloutRequest request,
      Instant now
  ) {
    long rolloutId = idGenerator.generateId();
    execute(
        """
        INSERT INTO core.service_rollout (
          id, release_id, stage, desired_state, actual_state, assignment_ids,
          approval_ref, started_at, created_at, updated_at
        ) VALUES (?, ?, 'PLANNED', 'ROLLOUT', 'PLANNED', ?::jsonb, ?, ?, ?, ?)
        """,
        rolloutId,
        releaseId,
        toJson(request.assignmentIds()),
        request.approvalRef(),
        timestamp(now),
        timestamp(now),
        timestamp(now)
    );
    return new ControlPlaneDtos.CreateRolloutResponse(rolloutId, "PLANNED", true);
  }

  public ControlPlaneDtos.ReleaseView loadRelease(long releaseId) {
    ReleaseRecord release = queryOne(
        """
        SELECT id, service_name, version, image_ref, status, change_summary, created_by, created_at
        FROM core.service_release
        WHERE id = ?
        """,
        rs -> new ReleaseRecord(
            getLong(rs, "id"),
            getString(rs, "service_name"),
            getString(rs, "version"),
            getString(rs, "image_ref"),
            getString(rs, "status"),
            getString(rs, "change_summary"),
            getString(rs, "created_by"),
            getInstant(rs, "created_at")
        ),
        releaseId
    ).orElseThrow(() -> new NoSuchElementException("Release not found: " + releaseId));

    List<ControlPlaneDtos.RolloutView> rollouts = queryList(
        """
        SELECT id, stage, desired_state, actual_state, assignment_ids, started_at, completed_at,
               approval_ref, error_summary
        FROM core.service_rollout
        WHERE release_id = ?
        ORDER BY started_at
        """,
        rs -> new ControlPlaneDtos.RolloutView(
            getLong(rs, "id"),
            getString(rs, "stage"),
            getString(rs, "desired_state"),
            getString(rs, "actual_state"),
            jsonLongList(getString(rs, "assignment_ids")),
            getInstant(rs, "started_at"),
            getInstant(rs, "completed_at"),
            getString(rs, "approval_ref"),
            getString(rs, "error_summary")
        ),
        releaseId
    );

    return new ControlPlaneDtos.ReleaseView(
        release.releaseId(),
        release.serviceName(),
        release.version(),
        release.imageRef(),
        release.status(),
        release.changeSummary(),
        release.createdBy(),
        release.createdAt(),
        rollouts
    );
  }

  public List<Long> findExpiredInstanceIds(Instant cutoff) {
    return queryList(
        """
        SELECT id
        FROM core.service_instance
        WHERE status NOT IN ('DOWN', 'DEREGISTERED')
          AND last_heartbeat_at < ?
        """,
        rs -> getLong(rs, "id"),
        timestamp(cutoff)
    );
  }

  public void markDown(List<Long> instanceIds, Instant now) {
    if (instanceIds == null || instanceIds.isEmpty()) {
      return;
    }
    executeInTransaction(connection -> {
      try (PreparedStatement statement = connection.prepareStatement(
          """
          UPDATE core.service_instance
          SET status = 'DOWN',
              last_offline_at = ?,
              updated_at = ?
          WHERE id = ?
          """
      )) {
        for (Long instanceId : instanceIds) {
          statement.setTimestamp(1, timestamp(now));
          statement.setTimestamp(2, timestamp(now));
          statement.setLong(3, instanceId);
          statement.addBatch();
        }
        statement.executeBatch();
      }
      return null;
    });
  }

  private void replaceAssignments(
      long instanceId,
      String serviceName,
      List<String> regionCodes,
      List<Long> outletIds,
      List<String> capabilities,
      Instant now
  ) {
    List<String> safeRegionCodes = regionCodes == null || regionCodes.isEmpty() ? java.util.Collections.emptyList() : regionCodes;
    List<Long> safeOutletIds = outletIds == null || outletIds.isEmpty() ? java.util.Collections.emptyList() : outletIds;
    List<String> safeCapabilities = capabilities == null || capabilities.isEmpty() ? java.util.Collections.emptyList() : capabilities;

    executeInTransaction(connection -> {
      try (PreparedStatement delete = connection.prepareStatement(
          "DELETE FROM core.service_assignment WHERE instance_id = ?"
      )) {
        delete.setLong(1, instanceId);
        delete.executeUpdate();
      }

      try (PreparedStatement insert = connection.prepareStatement(
          """
          INSERT INTO core.service_assignment (
            id, instance_id, service_name, region_code, outlet_id, capability,
            desired_instances, routing_weight, active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 1, 100, TRUE, ?, ?)
          """
      )) {
        boolean inserted = false;
        for (String regionCode : safeRegionCodes) {
          for (Long outletId : safeOutletIds) {
            for (String capability : safeCapabilities) {
              long assignmentId = idGenerator.generateId();
              insert.setLong(1, assignmentId);
              insert.setLong(2, instanceId);
              insert.setString(3, serviceName);
              if (regionCode == null) {
                insert.setNull(4, java.sql.Types.VARCHAR);
              } else {
                insert.setString(4, regionCode);
              }
              if (outletId == null) {
                insert.setNull(5, java.sql.Types.BIGINT);
              } else {
                insert.setLong(5, outletId);
              }
              if (capability == null) {
                insert.setNull(6, java.sql.Types.VARCHAR);
              } else {
                insert.setString(6, capability);
              }
              insert.setTimestamp(7, timestamp(now));
              insert.setTimestamp(8, timestamp(now));
              insert.addBatch();
              inserted = true;
            }
          }
        }
        if (!inserted) {
          long assignmentId = idGenerator.generateId();
          insert.setLong(1, assignmentId);
          insert.setLong(2, instanceId);
          insert.setString(3, serviceName);
          insert.setNull(4, java.sql.Types.VARCHAR);
          insert.setNull(5, java.sql.Types.BIGINT);
          insert.setNull(6, java.sql.Types.VARCHAR);
          insert.setTimestamp(7, timestamp(now));
          insert.setTimestamp(8, timestamp(now));
          insert.addBatch();
        }
        insert.executeBatch();
      }
      return null;
    });
  }

  private ServiceInstanceRecord mapInstance(ResultSet rs) {
    return new ServiceInstanceRecord(
        getLong(rs, "id"),
        getString(rs, "service_name"),
        getString(rs, "version"),
        getString(rs, "runtime"),
        getString(rs, "host"),
        getInt(rs, "port"),
        getString(rs, "status"),
        getInstant(rs, "first_registered_at"),
        getInstant(rs, "last_heartbeat_at"),
        getInstant(rs, "last_offline_at"),
        jsonMap(getString(rs, "metadata"))
    );
  }

  private AssignmentRecord mapAssignment(ResultSet rs) {
    return new AssignmentRecord(
        getLong(rs, "id"),
        getLong(rs, "instance_id"),
        getString(rs, "service_name"),
        getString(rs, "region_code"),
        getNullableLong(rs, "outlet_id"),
        getString(rs, "capability"),
        getInt(rs, "desired_instances"),
        getInt(rs, "routing_weight"),
        getBoolean(rs, "active")
    );
  }

  private long getLong(ResultSet rs, String column) {
    try {
      return rs.getLong(column);
    } catch (Exception e) {
      throw new IllegalStateException("Failed to read long column " + column, e);
    }
  }

  private Integer getInt(ResultSet rs, String column) {
    try {
      return rs.getInt(column);
    } catch (Exception e) {
      throw new IllegalStateException("Failed to read int column " + column, e);
    }
  }

  private Long getNullableLong(ResultSet rs, String column) {
    try {
      long value = rs.getLong(column);
      return rs.wasNull() ? null : value;
    } catch (Exception e) {
      throw new IllegalStateException("Failed to read nullable long column " + column, e);
    }
  }

  private String getString(ResultSet rs, String column) {
    try {
      return rs.getString(column);
    } catch (Exception e) {
      throw new IllegalStateException("Failed to read string column " + column, e);
    }
  }

  private boolean getBoolean(ResultSet rs, String column) {
    try {
      return rs.getBoolean(column);
    } catch (Exception e) {
      throw new IllegalStateException("Failed to read boolean column " + column, e);
    }
  }

  private Instant getInstant(ResultSet rs, String column) {
    try {
      Timestamp timestamp = rs.getTimestamp(column);
      return timestamp == null ? null : timestamp.toInstant();
    } catch (Exception e) {
      throw new IllegalStateException("Failed to read instant column " + column, e);
    }
  }

  private Timestamp timestamp(Instant instant) {
    return instant == null ? null : Timestamp.from(instant);
  }

  private String toJson(Object value) {
    try {
      return objectMapper.writeValueAsString(value == null ? Map.of() : value);
    } catch (Exception e) {
      throw new IllegalStateException("Failed to serialize JSON payload", e);
    }
  }

  private Map<String, Object> jsonMap(String raw) {
    try {
      if (raw == null || raw.isBlank()) {
        return Map.of();
      }
      return objectMapper.readValue(raw, new TypeReference<Map<String, Object>>() { });
    } catch (Exception e) {
      return Map.of();
    }
  }

  private List<Long> jsonLongList(String raw) {
    try {
      if (raw == null || raw.isBlank()) {
        return List.of();
      }
      return objectMapper.readValue(raw, new TypeReference<List<Long>>() { });
    } catch (Exception e) {
      return List.of();
    }
  }

  private static String defaultValue(String value, String fallback) {
    return value == null || value.isBlank() ? fallback : value;
  }

  public record ServiceInstanceRecord(
      long instanceId,
      String serviceName,
      String version,
      String runtime,
      String host,
      int port,
      String storedStatus,
      Instant firstRegisteredAt,
      Instant lastHeartbeatAt,
      Instant lastOfflineAt,
      Map<String, Object> metadata
  ) {
  }

  public record AssignmentRecord(
      long assignmentId,
      long instanceId,
      String serviceName,
      String regionCode,
      Long outletId,
      String capability,
      int desiredInstances,
      int routingWeight,
      boolean active
  ) {
  }

  private record ConfigProfile(
      long configVersion,
      String etag,
      Map<String, Object> properties
  ) {
  }

  private record ReleaseRecord(
      long releaseId,
      String serviceName,
      String version,
      String imageRef,
      String status,
      String changeSummary,
      String createdBy,
      Instant createdAt
  ) {
  }
}
