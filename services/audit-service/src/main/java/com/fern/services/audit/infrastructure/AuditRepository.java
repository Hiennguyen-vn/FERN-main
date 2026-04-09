package com.fern.services.audit.infrastructure;

import com.dorabets.common.repository.BaseRepository;
import com.dorabets.common.spring.web.PagedResult;
import com.dorabets.common.spring.web.QueryConventions;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fern.services.audit.api.AuditDtos;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.Optional;
import javax.sql.DataSource;
import org.springframework.stereotype.Repository;

@Repository
public class AuditRepository extends BaseRepository {

  private static final Set<String> AUDIT_LOG_SORT_KEYS = Set.of("createdAt", "entityName", "action", "actorUserId", "id");
  private static final Set<String> SECURITY_EVENT_SORT_KEYS = Set.of("createdAt", "severity", "eventType", "actorUserId", "id");
  private static final Set<String> TRACE_SORT_KEYS = Set.of("createdAt", "serviceName", "action", "statusCode", "durationMs", "id");

  private final ObjectMapper objectMapper;

  public AuditRepository(DataSource dataSource, ObjectMapper objectMapper) {
    super(dataSource);
    this.objectMapper = objectMapper;
  }

  public void append(AuditEntry entry) {
    executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.audit_log (
            id, actor_user_id, action, entity_name, entity_id, reason, old_data,
            new_data, ip_address, user_agent, created_at
          ) VALUES (?, ?, ?::audit_action_enum, ?, ?, ?, ?::jsonb, ?::jsonb, ?::inet, ?, ?)
          """
      )) {
        ps.setLong(1, entry.id());
        if (entry.actorUserId() == null) {
          ps.setNull(2, java.sql.Types.BIGINT);
        } else {
          ps.setLong(2, entry.actorUserId());
        }
        ps.setString(3, entry.action());
        ps.setString(4, entry.entityName());
        ps.setString(5, entry.entityId());
        ps.setString(6, entry.reason());
        if (entry.oldData() == null) {
          ps.setNull(7, java.sql.Types.OTHER);
        } else {
          ps.setString(7, objectMapper.writeValueAsString(entry.oldData()));
        }
        if (entry.newData() == null) {
          ps.setNull(8, java.sql.Types.OTHER);
        } else {
          ps.setString(8, objectMapper.writeValueAsString(entry.newData()));
        }
        ps.setString(9, entry.ipAddress());
        ps.setString(10, entry.userAgent());
        ps.setTimestamp(11, Timestamp.from(entry.createdAt()));
        ps.executeUpdate();
      }
      return null;
    });
  }

  public Optional<AuditDtos.AuditLogView> findLog(long auditLogId) {
    return queryOne(
        """
        SELECT id, actor_user_id, action, entity_name, entity_id, reason, old_data, new_data,
               ip_address, user_agent, created_at
        FROM core.audit_log
        WHERE id = ?
        """,
        this::mapAuditLog,
        auditLogId
    );
  }

  public PagedResult<AuditDtos.AuditLogView> listLogs(
      String entityName,
      String entityId,
      String action,
      String q,
      Long actorUserId,
      Instant createdFrom,
      Instant createdTo,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    return executeInTransaction(conn -> {
      StringBuilder sql = new StringBuilder(
          """
          SELECT id, actor_user_id, action, entity_name, entity_id, reason, old_data, new_data,
                 ip_address, user_agent, created_at, COUNT(*) OVER() AS total_count
          FROM core.audit_log
          WHERE 1 = 1
          """
      );
      List<Object> params = new ArrayList<>();
      if (entityName != null && !entityName.isBlank()) {
        sql.append(" AND entity_name = ?");
        params.add(entityName.trim());
      }
      if (entityId != null && !entityId.isBlank()) {
        sql.append(" AND entity_id = ?");
        params.add(entityId.trim());
      }
      if (action != null && !action.isBlank()) {
        sql.append(" AND action = ?::audit_action_enum");
        params.add(action.trim());
      }
      if (q != null && !q.isBlank()) {
        String pattern = "%" + q + "%";
        sql.append(
            """
             AND (
               entity_name ILIKE ?
               OR entity_id ILIKE ?
               OR action::text ILIKE ?
               OR COALESCE(reason, '') ILIKE ?
               OR COALESCE(ip_address::text, '') ILIKE ?
               OR COALESCE(user_agent, '') ILIKE ?
             )
            """
        );
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
      }
      if (actorUserId != null) {
        sql.append(" AND actor_user_id = ?");
        params.add(actorUserId);
      }
      if (createdFrom != null) {
        sql.append(" AND created_at >= ?");
        params.add(Timestamp.from(createdFrom));
      }
      if (createdTo != null) {
        sql.append(" AND created_at <= ?");
        params.add(Timestamp.from(createdTo));
      }
      sql.append(" ORDER BY ").append(resolveAuditLogSortClause(sortBy, sortDir)).append(" LIMIT ? OFFSET ?");
      params.add(Math.max(1, Math.min(limit, 500)));
      params.add(Math.max(offset, 0));
      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bind(ps, params);
        try (ResultSet rs = ps.executeQuery()) {
          List<AuditDtos.AuditLogView> rows = new ArrayList<>();
          long totalCount = 0;
          while (rs.next()) {
            totalCount = rs.getLong("total_count");
            rows.add(mapAuditLog(rs));
          }
          return PagedResult.of(rows, Math.max(1, Math.min(limit, 500)), Math.max(offset, 0), totalCount);
        }
      }
    });
  }

  public PagedResult<AuditDtos.SecurityEventView> listSecurityEvents(
      String severity,
      String q,
      Long actorUserId,
      Instant createdFrom,
      Instant createdTo,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    return executeInTransaction(conn -> {
      StringBuilder sql = new StringBuilder(
          """
          SELECT
            id,
            created_at,
            actor_user_id,
            action,
            entity_name,
            entity_id,
            reason,
            ip_address,
            user_agent,
            CASE
              WHEN action IN ('delete'::audit_action_enum, 'reject'::audit_action_enum) THEN 'critical'
              WHEN action IN ('cancel'::audit_action_enum, 'logout'::audit_action_enum) THEN 'warning'
              ELSE 'info'
            END AS severity,
            COALESCE(NULLIF(new_data ->> 'eventType', ''), reason, action::text) AS event_type,
            COALESCE(
              NULLIF(new_data ->> 'description', ''),
              reason,
              action::text || ' on ' || entity_name
            ) AS description,
            COUNT(*) OVER() AS total_count
          FROM core.audit_log
          WHERE 1 = 1
          """
      );
      List<Object> params = new ArrayList<>();
      if (severity != null && !severity.isBlank()) {
        sql.append(
            """
             AND (
               CASE
                 WHEN action IN ('delete'::audit_action_enum, 'reject'::audit_action_enum) THEN 'critical'
                 WHEN action IN ('cancel'::audit_action_enum, 'logout'::audit_action_enum) THEN 'warning'
                 ELSE 'info'
               END
             ) = ?
            """
        );
        params.add(severity.trim().toLowerCase(java.util.Locale.ROOT));
      }
      if (q != null && !q.isBlank()) {
        String pattern = "%" + q + "%";
        sql.append(
            """
             AND (
               action::text ILIKE ?
               OR entity_name ILIKE ?
               OR COALESCE(entity_id, '') ILIKE ?
               OR COALESCE(reason, '') ILIKE ?
               OR COALESCE(new_data ->> 'eventType', '') ILIKE ?
               OR COALESCE(new_data ->> 'description', '') ILIKE ?
             )
            """
        );
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
      }
      if (actorUserId != null) {
        sql.append(" AND actor_user_id = ?");
        params.add(actorUserId);
      }
      if (createdFrom != null) {
        sql.append(" AND created_at >= ?");
        params.add(Timestamp.from(createdFrom));
      }
      if (createdTo != null) {
        sql.append(" AND created_at <= ?");
        params.add(Timestamp.from(createdTo));
      }
      sql.append(" ORDER BY ").append(resolveSecurityEventSortClause(sortBy, sortDir)).append(" LIMIT ? OFFSET ?");
      params.add(Math.max(1, Math.min(limit, 500)));
      params.add(Math.max(offset, 0));

      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bind(ps, params);
        try (ResultSet rs = ps.executeQuery()) {
          List<AuditDtos.SecurityEventView> rows = new ArrayList<>();
          long totalCount = 0;
          while (rs.next()) {
            totalCount = rs.getLong("total_count");
            rows.add(mapSecurityEvent(rs));
          }
          return PagedResult.of(rows, Math.max(1, Math.min(limit, 500)), Math.max(offset, 0), totalCount);
        }
      }
    });
  }

  public PagedResult<AuditDtos.TraceView> listTraces(
      String action,
      String entityName,
      String q,
      Long actorUserId,
      Instant createdFrom,
      Instant createdTo,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    return executeInTransaction(conn -> {
      StringBuilder sql = new StringBuilder(
          """
          SELECT
            id,
            created_at,
            actor_user_id,
            action,
            entity_name,
            entity_id,
            reason,
            COALESCE(
              NULLIF(new_data ->> 'correlationId', ''),
              NULLIF(old_data ->> 'correlationId', '')
            ) AS correlation_id,
            COALESCE(
              NULLIF(new_data ->> 'method', ''),
              NULLIF(old_data ->> 'method', '')
            ) AS request_method,
            COALESCE(
              NULLIF(new_data ->> 'path', ''),
              NULLIF(old_data ->> 'path', '')
            ) AS request_path,
            CASE
              WHEN COALESCE(NULLIF(new_data ->> 'statusCode', ''), NULLIF(old_data ->> 'statusCode', '')) ~ '^[0-9]+$'
                THEN COALESCE(NULLIF(new_data ->> 'statusCode', ''), NULLIF(old_data ->> 'statusCode', ''))::INT
              ELSE NULL
            END AS status_code,
            CASE
              WHEN COALESCE(NULLIF(new_data ->> 'durationMs', ''), NULLIF(old_data ->> 'durationMs', '')) ~ '^[0-9]+$'
                THEN COALESCE(NULLIF(new_data ->> 'durationMs', ''), NULLIF(old_data ->> 'durationMs', ''))::INT
              ELSE NULL
            END AS duration_ms,
            COALESCE(
              NULLIF(new_data ->> 'service', ''),
              NULLIF(old_data ->> 'service', ''),
              NULLIF(split_part(reason, '.', 1), '')
            ) AS service_name,
            ip_address,
            user_agent,
            COUNT(*) OVER() AS total_count
          FROM core.audit_log
          WHERE 1 = 1
          """
      );
      List<Object> params = new ArrayList<>();
      if (action != null && !action.isBlank()) {
        sql.append(" AND action::text = ?");
        params.add(action.trim().toLowerCase(java.util.Locale.ROOT));
      }
      if (entityName != null && !entityName.isBlank()) {
        sql.append(" AND entity_name = ?");
        params.add(entityName.trim());
      }
      if (q != null && !q.isBlank()) {
        String pattern = "%" + q + "%";
        sql.append(
            """
             AND (
               action::text ILIKE ?
               OR entity_name ILIKE ?
               OR COALESCE(entity_id, '') ILIKE ?
               OR COALESCE(reason, '') ILIKE ?
               OR COALESCE(new_data ->> 'correlationId', old_data ->> 'correlationId', '') ILIKE ?
               OR COALESCE(new_data ->> 'path', old_data ->> 'path', '') ILIKE ?
               OR COALESCE(new_data ->> 'service', old_data ->> 'service', '') ILIKE ?
             )
            """
        );
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
      }
      if (actorUserId != null) {
        sql.append(" AND actor_user_id = ?");
        params.add(actorUserId);
      }
      if (createdFrom != null) {
        sql.append(" AND created_at >= ?");
        params.add(Timestamp.from(createdFrom));
      }
      if (createdTo != null) {
        sql.append(" AND created_at <= ?");
        params.add(Timestamp.from(createdTo));
      }
      sql.append(" ORDER BY ").append(resolveTraceSortClause(sortBy, sortDir)).append(" LIMIT ? OFFSET ?");
      params.add(Math.max(1, Math.min(limit, 500)));
      params.add(Math.max(offset, 0));

      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bind(ps, params);
        try (ResultSet rs = ps.executeQuery()) {
          List<AuditDtos.TraceView> rows = new ArrayList<>();
          long totalCount = 0;
          while (rs.next()) {
            totalCount = rs.getLong("total_count");
            rows.add(mapTrace(rs));
          }
          return PagedResult.of(rows, Math.max(1, Math.min(limit, 500)), Math.max(offset, 0), totalCount);
        }
      }
    });
  }

  private AuditDtos.AuditLogView mapAuditLog(ResultSet rs) {
    try {
      return new AuditDtos.AuditLogView(
          rs.getLong("id"),
          rs.getObject("actor_user_id", Long.class),
          rs.getString("action"),
          rs.getString("entity_name"),
          rs.getString("entity_id"),
          rs.getString("reason"),
          parseJson(rs.getString("old_data")),
          parseJson(rs.getString("new_data")),
          rs.getString("ip_address"),
          rs.getString("user_agent"),
          rs.getTimestamp("created_at").toInstant()
      );
    } catch (SQLException e) {
      throw new IllegalStateException("Failed to map audit log row", e);
    }
  }

  private AuditDtos.SecurityEventView mapSecurityEvent(ResultSet rs) {
    try {
      return new AuditDtos.SecurityEventView(
          rs.getLong("id"),
          rs.getTimestamp("created_at").toInstant(),
          rs.getString("severity"),
          rs.getString("event_type"),
          rs.getObject("actor_user_id", Long.class),
          rs.getString("action"),
          rs.getString("entity_name"),
          rs.getString("entity_id"),
          rs.getString("ip_address"),
          rs.getString("user_agent"),
          rs.getString("description")
      );
    } catch (SQLException e) {
      throw new IllegalStateException("Failed to map security event row", e);
    }
  }

  private AuditDtos.TraceView mapTrace(ResultSet rs) {
    try {
      return new AuditDtos.TraceView(
          rs.getLong("id"),
          rs.getTimestamp("created_at").toInstant(),
          rs.getString("correlation_id"),
          rs.getString("request_method"),
          rs.getString("request_path"),
          rs.getObject("status_code", Integer.class),
          rs.getObject("duration_ms", Integer.class),
          rs.getObject("actor_user_id", Long.class),
          rs.getString("action"),
          rs.getString("entity_name"),
          rs.getString("entity_id"),
          rs.getString("service_name"),
          rs.getString("ip_address"),
          rs.getString("user_agent")
      );
    } catch (SQLException e) {
      throw new IllegalStateException("Failed to map trace row", e);
    }
  }

  private String resolveAuditLogSortClause(String sortBy, String sortDir) {
    String key = QueryConventions.normalizeSortBy(sortBy, AUDIT_LOG_SORT_KEYS, "createdAt");
    String direction = QueryConventions.normalizeSortDir(sortDir);
    return switch (key) {
      case "entityName" -> "entity_name " + direction + ", id " + direction;
      case "action" -> "action " + direction + ", id " + direction;
      case "actorUserId" -> "actor_user_id " + direction + ", id " + direction;
      case "id" -> "id " + direction;
      case "createdAt" -> "created_at " + direction + ", id " + direction;
      default -> throw new IllegalArgumentException("Unsupported audit log sort key");
    };
  }

  private String resolveSecurityEventSortClause(String sortBy, String sortDir) {
    String key = QueryConventions.normalizeSortBy(sortBy, SECURITY_EVENT_SORT_KEYS, "createdAt");
    String direction = QueryConventions.normalizeSortDir(sortDir);
    String severityExpr = """
        CASE
          WHEN action IN ('delete'::audit_action_enum, 'reject'::audit_action_enum) THEN 'critical'
          WHEN action IN ('cancel'::audit_action_enum, 'logout'::audit_action_enum) THEN 'warning'
          ELSE 'info'
        END
        """.trim().replace("\n", " ");
    String eventTypeExpr = "COALESCE(NULLIF(new_data ->> 'eventType', ''), reason, action::text)";
    return switch (key) {
      case "severity" -> severityExpr + " " + direction + ", created_at DESC, id DESC";
      case "eventType" -> eventTypeExpr + " " + direction + ", created_at DESC, id DESC";
      case "actorUserId" -> "actor_user_id " + direction + ", created_at DESC, id DESC";
      case "id" -> "id " + direction;
      case "createdAt" -> "created_at " + direction + ", id " + direction;
      default -> throw new IllegalArgumentException("Unsupported security event sort key");
    };
  }

  private String resolveTraceSortClause(String sortBy, String sortDir) {
    String key = QueryConventions.normalizeSortBy(sortBy, TRACE_SORT_KEYS, "createdAt");
    String direction = QueryConventions.normalizeSortDir(sortDir);
    String serviceExpr =
        "COALESCE(NULLIF(new_data ->> 'service', ''), NULLIF(old_data ->> 'service', ''), NULLIF(split_part(reason, '.', 1), ''))";
    String statusExpr =
        "CASE WHEN COALESCE(NULLIF(new_data ->> 'statusCode', ''), NULLIF(old_data ->> 'statusCode', '')) ~ '^[0-9]+$' "
            + "THEN COALESCE(NULLIF(new_data ->> 'statusCode', ''), NULLIF(old_data ->> 'statusCode', ''))::INT ELSE NULL END";
    String durationExpr =
        "CASE WHEN COALESCE(NULLIF(new_data ->> 'durationMs', ''), NULLIF(old_data ->> 'durationMs', '')) ~ '^[0-9]+$' "
            + "THEN COALESCE(NULLIF(new_data ->> 'durationMs', ''), NULLIF(old_data ->> 'durationMs', ''))::INT ELSE NULL END";
    return switch (key) {
      case "serviceName" -> serviceExpr + " " + direction + ", created_at DESC, id DESC";
      case "action" -> "action " + direction + ", created_at DESC, id DESC";
      case "statusCode" -> statusExpr + " " + direction + " NULLS LAST, created_at DESC, id DESC";
      case "durationMs" -> durationExpr + " " + direction + " NULLS LAST, created_at DESC, id DESC";
      case "id" -> "id " + direction;
      case "createdAt" -> "created_at " + direction + ", id " + direction;
      default -> throw new IllegalArgumentException("Unsupported trace sort key");
    };
  }

  private JsonNode parseJson(String raw) {
    if (raw == null || raw.isBlank()) {
      return null;
    }
    try {
      return objectMapper.readTree(raw);
    } catch (Exception e) {
      throw new IllegalStateException("Failed to parse audit json payload", e);
    }
  }

  private void bind(PreparedStatement ps, List<Object> params) throws SQLException {
    for (int i = 0; i < params.size(); i++) {
      ps.setObject(i + 1, params.get(i));
    }
  }

  public record AuditEntry(
      long id,
      Long actorUserId,
      String action,
      String entityName,
      String entityId,
      String reason,
      JsonNode oldData,
      JsonNode newData,
      String ipAddress,
      String userAgent,
      Instant createdAt
  ) {
  }
}
