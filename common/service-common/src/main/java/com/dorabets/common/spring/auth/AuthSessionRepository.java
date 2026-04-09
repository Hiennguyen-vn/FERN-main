package com.dorabets.common.spring.auth;

import com.dorabets.common.repository.BaseRepository;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import javax.sql.DataSource;
import org.springframework.stereotype.Repository;

@Repository
public class AuthSessionRepository extends BaseRepository {

  private final Clock clock;

  public AuthSessionRepository(DataSource dataSource, Clock clock) {
    super(dataSource);
    this.clock = clock;
  }

  public AuthSessionRecord createSession(CreateSessionCommand command) {
    return executeInTransaction(conn -> {
      Instant now = clock.instant();
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.auth_session (
            session_id, user_id, issued_at, expires_at, refreshed_at,
            user_agent, client_ip, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          """
      )) {
        ps.setString(1, command.sessionId());
        ps.setLong(2, command.userId());
        ps.setTimestamp(3, Timestamp.from(command.issuedAt()));
        ps.setTimestamp(4, Timestamp.from(command.expiresAt()));
        ps.setTimestamp(5, command.refreshedAt() == null ? null : Timestamp.from(command.refreshedAt()));
        ps.setString(6, command.userAgent());
        ps.setString(7, command.clientIp());
        ps.setTimestamp(8, Timestamp.from(now));
        ps.setTimestamp(9, Timestamp.from(now));
        ps.executeUpdate();
      }
      return findBySessionId(conn, command.sessionId())
          .orElseThrow(() -> new IllegalStateException("Created auth session not found: " + command.sessionId()));
    });
  }

  public Optional<AuthSessionRecord> findBySessionId(String sessionId) {
    return executeInTransaction(conn -> findBySessionId(conn, sessionId));
  }

  public List<AuthSessionRecord> listSessionsForUser(long userId) {
    return queryList(
        """
        SELECT session_id, user_id, issued_at, expires_at, refreshed_at,
               revoked_at, revoked_by_user_id, revoke_reason, user_agent, client_ip,
               created_at, updated_at
        FROM core.auth_session
        WHERE user_id = ?
        ORDER BY issued_at DESC, session_id DESC
        """,
        this::mapSession,
        userId
    );
  }

  public boolean isSessionActive(String sessionId, long userId, Instant now) {
    return queryOne(
        """
        SELECT 1
        FROM core.auth_session
        WHERE session_id = ?
          AND user_id = ?
          AND revoked_at IS NULL
          AND expires_at > ?
        """,
        rs -> true,
        sessionId,
        userId,
        Timestamp.from(now)
    ).orElse(false);
  }

  public Optional<AuthSessionRecord> revokeSession(
      String sessionId,
      long userId,
      Long revokedByUserId,
      String reason
  ) {
    return executeInTransaction(conn -> {
      Instant now = clock.instant();
      try (PreparedStatement ps = conn.prepareStatement(
          """
          UPDATE core.auth_session
          SET revoked_at = COALESCE(revoked_at, ?),
              revoked_by_user_id = COALESCE(revoked_by_user_id, ?),
              revoke_reason = COALESCE(revoke_reason, ?),
              updated_at = ?
          WHERE session_id = ?
            AND user_id = ?
          """
      )) {
        ps.setTimestamp(1, Timestamp.from(now));
        if (revokedByUserId == null) {
          ps.setNull(2, java.sql.Types.BIGINT);
        } else {
          ps.setLong(2, revokedByUserId);
        }
        ps.setString(3, reason);
        ps.setTimestamp(4, Timestamp.from(now));
        ps.setString(5, sessionId);
        ps.setLong(6, userId);
        ps.executeUpdate();
      }
      return findBySessionId(conn, sessionId);
    });
  }

  public int revokeOtherSessions(
      long userId,
      String keepSessionId,
      Long revokedByUserId,
      String reason
  ) {
    Instant now = clock.instant();
    return execute(
        """
        UPDATE core.auth_session
        SET revoked_at = COALESCE(revoked_at, ?),
            revoked_by_user_id = COALESCE(revoked_by_user_id, ?),
            revoke_reason = COALESCE(revoke_reason, ?),
            updated_at = ?
        WHERE user_id = ?
          AND session_id <> ?
          AND revoked_at IS NULL
        """,
        Timestamp.from(now),
        revokedByUserId,
        reason,
        Timestamp.from(now),
        userId,
        keepSessionId
    );
  }

  private Optional<AuthSessionRecord> findBySessionId(Connection conn, String sessionId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT session_id, user_id, issued_at, expires_at, refreshed_at,
               revoked_at, revoked_by_user_id, revoke_reason, user_agent, client_ip,
               created_at, updated_at
        FROM core.auth_session
        WHERE session_id = ?
        """
    )) {
      ps.setString(1, sessionId);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) {
          return Optional.empty();
        }
        return Optional.of(mapSession(rs));
      }
    }
  }

  private AuthSessionRecord mapSession(ResultSet rs) {
    try {
      Timestamp refreshedAt = rs.getTimestamp("refreshed_at");
      Timestamp revokedAt = rs.getTimestamp("revoked_at");
      Timestamp createdAt = rs.getTimestamp("created_at");
      Timestamp updatedAt = rs.getTimestamp("updated_at");
      return new AuthSessionRecord(
          rs.getString("session_id"),
          rs.getLong("user_id"),
          rs.getTimestamp("issued_at").toInstant(),
          rs.getTimestamp("expires_at").toInstant(),
          refreshedAt == null ? null : refreshedAt.toInstant(),
          revokedAt == null ? null : revokedAt.toInstant(),
          rs.getObject("revoked_by_user_id", Long.class),
          rs.getString("revoke_reason"),
          rs.getString("user_agent"),
          rs.getString("client_ip"),
          createdAt == null ? null : createdAt.toInstant(),
          updatedAt == null ? null : updatedAt.toInstant()
      );
    } catch (Exception e) {
      throw new IllegalStateException("Unable to map auth session", e);
    }
  }

  public record CreateSessionCommand(
      String sessionId,
      long userId,
      Instant issuedAt,
      Instant expiresAt,
      Instant refreshedAt,
      String userAgent,
      String clientIp
  ) {
  }

  public record AuthSessionRecord(
      String sessionId,
      long userId,
      Instant issuedAt,
      Instant expiresAt,
      Instant refreshedAt,
      Instant revokedAt,
      Long revokedByUserId,
      String revokeReason,
      String userAgent,
      String clientIp,
      Instant createdAt,
      Instant updatedAt
  ) {
  }
}
