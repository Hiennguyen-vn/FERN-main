package com.fern.services.product.infrastructure;

import com.dorabets.common.repository.BaseRepository;
import com.fern.services.product.api.PublishDtos;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import javax.sql.DataSource;
import org.springframework.stereotype.Repository;

@Repository
public class PublishRepository extends BaseRepository {

  private final SnowflakeIdGenerator snowflakeIdGenerator;

  public PublishRepository(DataSource dataSource, SnowflakeIdGenerator snowflakeIdGenerator) {
    super(dataSource);
    this.snowflakeIdGenerator = snowflakeIdGenerator;
  }

  public List<PublishDtos.PublishVersionView> listVersions(String status, int limit, int offset) {
    StringBuilder sql = new StringBuilder("""
        SELECT pv.id, pv.name, pv.description, pv.status,
               pv.created_by_user_id, pv.submitted_at, pv.reviewed_at, pv.reviewed_by_user_id,
               pv.review_note, pv.scheduled_at, pv.published_at, pv.published_by_user_id,
               pv.rolled_back_at, pv.rolled_back_by_user_id, pv.rollback_reason,
               pv.created_at, pv.updated_at,
               (SELECT COUNT(*) FROM core.publish_item pi WHERE pi.publish_version_id = pv.id) AS item_count
        FROM core.publish_version pv
        """);
    List<Object> params = new ArrayList<>();
    if (status != null && !status.isBlank()) {
      sql.append(" WHERE pv.status = ?");
      params.add(status);
    }
    sql.append(" ORDER BY pv.created_at DESC LIMIT ? OFFSET ?");
    params.add(limit);
    params.add(offset);

    return queryList(sql.toString(), rs -> {
      try {
        return new PublishDtos.PublishVersionView(
            rs.getLong("id"),
            rs.getString("name"),
            rs.getString("description"),
            rs.getString("status"),
            rs.getObject("created_by_user_id") != null ? rs.getLong("created_by_user_id") : null,
            toInstant(rs.getTimestamp("submitted_at")),
            toInstant(rs.getTimestamp("reviewed_at")),
            rs.getObject("reviewed_by_user_id") != null ? rs.getLong("reviewed_by_user_id") : null,
            rs.getString("review_note"),
            toInstant(rs.getTimestamp("scheduled_at")),
            toInstant(rs.getTimestamp("published_at")),
            toInstant(rs.getTimestamp("rolled_back_at")),
            rs.getString("rollback_reason"),
            rs.getInt("item_count"),
            toInstant(rs.getTimestamp("created_at"))
        );
      } catch (Exception e) { throw new IllegalStateException("map publish version", e); }
    }, params.toArray());
  }

  public Optional<PublishDtos.PublishVersionView> findVersion(long id) {
    return listVersions(null, 1000, 0).stream().filter(v -> v.id() == id).findFirst();
  }

  public PublishDtos.PublishVersionView createVersion(String name, String description, long userId) {
    long id = snowflakeIdGenerator.generateId();
    execute("""
        INSERT INTO core.publish_version (id, name, description, created_by_user_id)
        VALUES (?, ?, ?, ?)
        """, id, name, description, userId);
    return findVersion(id).orElseThrow();
  }

  public void updateStatus(long versionId, String status, Long userId) {
    String timestampCol = switch (status) {
      case "review" -> "submitted_at";
      case "approved", "rejected" -> "reviewed_at";
      case "published" -> "published_at";
      case "rolled_back" -> "rolled_back_at";
      default -> null;
    };
    String userCol = switch (status) {
      case "review" -> "submitted_by_user_id";
      case "approved", "rejected" -> "reviewed_by_user_id";
      case "published" -> "published_by_user_id";
      case "rolled_back" -> "rolled_back_by_user_id";
      default -> null;
    };

    StringBuilder sb = new StringBuilder("UPDATE core.publish_version SET status = ?, updated_at = now()");
    List<Object> params = new ArrayList<>();
    params.add(status);
    if (timestampCol != null) { sb.append(", ").append(timestampCol).append(" = now()"); }
    if (userCol != null && userId != null) { sb.append(", ").append(userCol).append(" = ?"); params.add(userId); }
    sb.append(" WHERE id = ?");
    params.add(versionId);
    execute(sb.toString(), params.toArray());
  }

  public void setReviewNote(long versionId, String note) {
    execute("UPDATE core.publish_version SET review_note = ?, updated_at = now() WHERE id = ?", note, versionId);
  }

  public void setRollbackReason(long versionId, String reason) {
    execute("UPDATE core.publish_version SET rollback_reason = ?, updated_at = now() WHERE id = ?", reason, versionId);
  }

  public void setScheduledAt(long versionId, Instant scheduledAt) {
    execute("UPDATE core.publish_version SET scheduled_at = ?, updated_at = now() WHERE id = ?",
        Timestamp.from(scheduledAt), versionId);
  }

  // ── Items ──

  public List<PublishDtos.PublishItemView> listItems(long versionId) {
    return queryList("""
        SELECT pi.id, pi.entity_type, pi.entity_id, pi.change_type, pi.scope_type, pi.scope_id,
               pi.summary, pi.before_snapshot, pi.after_snapshot, pi.created_at
        FROM core.publish_item pi
        WHERE pi.publish_version_id = ?
        ORDER BY pi.created_at
        """, rs -> {
      try {
        return new PublishDtos.PublishItemView(
            rs.getLong("id"),
            rs.getString("entity_type"),
            rs.getLong("entity_id"),
            rs.getString("change_type"),
            rs.getString("scope_type"),
            rs.getString("scope_id"),
            rs.getString("summary"),
            rs.getString("before_snapshot"),
            rs.getString("after_snapshot"),
            toInstant(rs.getTimestamp("created_at"))
        );
      } catch (Exception e) { throw new IllegalStateException("map publish item", e); }
    }, versionId);
  }

  public PublishDtos.PublishItemView addItem(long versionId, PublishDtos.AddPublishItemRequest req) {
    long id = snowflakeIdGenerator.generateId();
    execute("""
        INSERT INTO core.publish_item (id, publish_version_id, entity_type, entity_id, change_type, scope_type, scope_id, summary, before_snapshot, after_snapshot)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb)
        """, id, versionId, req.entityType(), req.entityId(), req.changeType(),
        req.scopeType(), req.scopeId(), req.summary(), req.beforeSnapshot(), req.afterSnapshot());
    return listItems(versionId).stream().filter(i -> i.id() == id).findFirst().orElseThrow();
  }

  public void removeItem(long itemId) {
    execute("DELETE FROM core.publish_item WHERE id = ?", itemId);
  }

  // ── Audit log ──

  public List<PublishDtos.AuditLogView> listAuditLog(String entityType, Long entityId, Long userId, int limit, int offset) {
    StringBuilder sql = new StringBuilder("""
        SELECT al.id, al.entity_type, al.entity_id, al.action, al.field_name,
               al.old_value, al.new_value, al.scope_type, al.scope_id,
               al.user_id, al.username, al.publish_version_id, al.created_at
        FROM core.catalog_audit_log al
        WHERE 1=1
        """);
    List<Object> params = new ArrayList<>();
    if (entityType != null) { sql.append(" AND al.entity_type = ?"); params.add(entityType); }
    if (entityId != null) { sql.append(" AND al.entity_id = ?"); params.add(entityId); }
    if (userId != null) { sql.append(" AND al.user_id = ?"); params.add(userId); }
    sql.append(" ORDER BY al.created_at DESC LIMIT ? OFFSET ?");
    params.add(limit);
    params.add(offset);

    return queryList(sql.toString(), rs -> {
      try {
        return new PublishDtos.AuditLogView(
            rs.getLong("id"),
            rs.getString("entity_type"),
            rs.getLong("entity_id"),
            rs.getString("action"),
            rs.getString("field_name"),
            rs.getString("old_value"),
            rs.getString("new_value"),
            rs.getString("scope_type"),
            rs.getString("scope_id"),
            rs.getObject("user_id") != null ? rs.getLong("user_id") : null,
            rs.getString("username"),
            rs.getObject("publish_version_id") != null ? rs.getLong("publish_version_id") : null,
            toInstant(rs.getTimestamp("created_at"))
        );
      } catch (Exception e) { throw new IllegalStateException("map audit log", e); }
    }, params.toArray());
  }

  public void writeAuditLog(String entityType, long entityId, String action, String fieldName,
      String oldValue, String newValue, String scopeType, String scopeId,
      Long userId, String username, Long publishVersionId) {
    long id = snowflakeIdGenerator.generateId();
    execute("""
        INSERT INTO core.catalog_audit_log (id, entity_type, entity_id, action, field_name, old_value, new_value,
            scope_type, scope_id, user_id, username, publish_version_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, id, entityType, entityId, action, fieldName, oldValue, newValue,
        scopeType, scopeId, userId, username, publishVersionId);
  }

  private static Instant toInstant(Timestamp ts) {
    return ts != null ? ts.toInstant() : null;
  }
}
