package com.fern.services.auth.spring.infrastructure;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.repository.BaseRepository;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.Optional;
import javax.sql.DataSource;
import org.springframework.stereotype.Repository;

@Repository
public class DeviceRepository extends BaseRepository {

  private final SnowflakeIdGenerator snowflakeIdGenerator;
  private final Clock clock;

  public DeviceRepository(DataSource dataSource, SnowflakeIdGenerator snowflakeIdGenerator, Clock clock) {
    super(dataSource);
    this.snowflakeIdGenerator = snowflakeIdGenerator;
    this.clock = clock;
  }

  public record PairTokenRecord(
      long id, long outletId, String tokenHash,
      String deviceLabel, int workerId, long issuedBy,
      Instant expiresAt, Instant usedAt
  ) {}

  public record DeviceRecord(
      long id, long outletId, String deviceLabel, int workerId,
      String tokenHash, Instant tokenExpiresAt,
      Instant pairedAt, Instant revokedAt, Instant lastSeenAt
  ) {}

  public long insertPairToken(long outletId, String tokenHash, String deviceLabel, int workerId,
      long issuedBy, Instant expiresAt) {
    long id = snowflakeIdGenerator.generateId();
    executeInTransaction(conn -> {
      try (var ps = conn.prepareStatement("""
          INSERT INTO core.device_pair_token
            (id, outlet_id, token_hash, device_label, worker_id, issued_by, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          """)) {
        ps.setLong(1, id);
        ps.setLong(2, outletId);
        ps.setString(3, tokenHash);
        ps.setString(4, deviceLabel);
        ps.setInt(5, workerId);
        ps.setLong(6, issuedBy);
        ps.setTimestamp(7, Timestamp.from(expiresAt));
        ps.executeUpdate();
      }
      return null;
    });
    return id;
  }

  public Optional<PairTokenRecord> findPairTokenByHash(String tokenHash) {
    return queryOne("""
        SELECT id, outlet_id, token_hash, device_label, worker_id, issued_by, expires_at, used_at
        FROM core.device_pair_token
        WHERE token_hash = ?
        """,
        this::mapPairToken,
        tokenHash
    );
  }

  public DeviceRecord redeemPairToken(long pairTokenId, String deviceTokenHash, Instant tokenExpiresAt) {
    return executeInTransaction(conn -> {
      Instant now = clock.instant();
      try (var ps = conn.prepareStatement(
          "UPDATE core.device_pair_token SET used_at = ? WHERE id = ? AND used_at IS NULL")) {
        ps.setTimestamp(1, Timestamp.from(now));
        ps.setLong(2, pairTokenId);
        int rows = ps.executeUpdate();
        if (rows == 0) {
          throw ServiceException.conflict("Pair token already used");
        }
      }

      try (var sel = conn.prepareStatement(
          "SELECT outlet_id, device_label, worker_id FROM core.device_pair_token WHERE id = ?")) {
        sel.setLong(1, pairTokenId);
        try (var rs = sel.executeQuery()) {
          if (!rs.next()) throw ServiceException.notFound("Pair token not found");
          long outletId = rs.getLong("outlet_id");
          String deviceLabel = rs.getString("device_label");
          int workerId = rs.getInt("worker_id");

          long deviceId = snowflakeIdGenerator.generateId();
          try (var ins = conn.prepareStatement("""
              INSERT INTO core.device_registry
                (id, outlet_id, device_label, worker_id, token_hash, token_expires_at, paired_at, issued_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (worker_id) DO UPDATE SET
                outlet_id = EXCLUDED.outlet_id,
                device_label = EXCLUDED.device_label,
                token_hash = EXCLUDED.token_hash,
                token_expires_at = EXCLUDED.token_expires_at,
                paired_at = EXCLUDED.paired_at,
                revoked_at = NULL,
                last_seen_at = NOW()
              RETURNING id
              """)) {
            ins.setLong(1, deviceId);
            ins.setLong(2, outletId);
            ins.setString(3, deviceLabel);
            ins.setInt(4, workerId);
            ins.setString(5, deviceTokenHash);
            ins.setTimestamp(6, Timestamp.from(tokenExpiresAt));
            ins.setTimestamp(7, Timestamp.from(now));
            ins.setTimestamp(8, Timestamp.from(now));
            try (var devRs = ins.executeQuery()) {
              devRs.next();
              long resolvedDeviceId = devRs.getLong(1);
              return new DeviceRecord(resolvedDeviceId, outletId, deviceLabel, workerId,
                  deviceTokenHash, tokenExpiresAt, now, null, now);
            }
          }
        }
      }
    });
  }

  public Optional<DeviceRecord> findActiveDeviceById(long deviceId) {
    return queryOne("""
        SELECT id, outlet_id, device_label, worker_id, token_hash, token_expires_at,
               paired_at, revoked_at, last_seen_at
        FROM core.device_registry
        WHERE id = ? AND revoked_at IS NULL
        """,
        this::mapDevice,
        deviceId
    );
  }

  public void updateDeviceToken(long deviceId, String newTokenHash, Instant newExpiresAt) {
    executeInTransaction(conn -> {
      try (var ps = conn.prepareStatement("""
          UPDATE core.device_registry
          SET token_hash = ?, token_expires_at = ?, last_seen_at = NOW()
          WHERE id = ? AND revoked_at IS NULL
          """)) {
        ps.setString(1, newTokenHash);
        ps.setTimestamp(2, Timestamp.from(newExpiresAt));
        ps.setLong(3, deviceId);
        ps.executeUpdate();
      }
      return null;
    });
  }

  public void revokeDevice(long deviceId) {
    executeInTransaction(conn -> {
      try (var ps = conn.prepareStatement("""
          UPDATE core.device_registry SET revoked_at = NOW() WHERE id = ? AND revoked_at IS NULL
          """)) {
        ps.setLong(1, deviceId);
        int rows = ps.executeUpdate();
        if (rows == 0) throw ServiceException.notFound("Device not found or already revoked: " + deviceId);
      }
      return null;
    });
  }

  public void touchLastSeen(long deviceId) {
    executeInTransaction(conn -> {
      try (var ps = conn.prepareStatement(
          "UPDATE core.device_registry SET last_seen_at = NOW() WHERE id = ?")) {
        ps.setLong(1, deviceId);
        ps.executeUpdate();
      }
      return null;
    });
  }

  private PairTokenRecord mapPairToken(java.sql.ResultSet rs) {
    try {
      java.sql.Timestamp usedAt = rs.getTimestamp("used_at");
      return new PairTokenRecord(
          rs.getLong("id"), rs.getLong("outlet_id"), rs.getString("token_hash"),
          rs.getString("device_label"), rs.getInt("worker_id"), rs.getLong("issued_by"),
          rs.getTimestamp("expires_at").toInstant(),
          usedAt != null ? usedAt.toInstant() : null
      );
    } catch (java.sql.SQLException e) {
      throw new IllegalStateException("Unable to map pair token", e);
    }
  }

  private DeviceRecord mapDevice(java.sql.ResultSet rs) {
    try {
      Timestamp pairedAt = rs.getTimestamp("paired_at");
      Timestamp revokedAt = rs.getTimestamp("revoked_at");
      Timestamp lastSeen = rs.getTimestamp("last_seen_at");
      Timestamp tokenExp = rs.getTimestamp("token_expires_at");
      return new DeviceRecord(
          rs.getLong("id"), rs.getLong("outlet_id"), rs.getString("device_label"),
          rs.getInt("worker_id"), rs.getString("token_hash"),
          tokenExp != null ? tokenExp.toInstant() : null,
          pairedAt != null ? pairedAt.toInstant() : null,
          revokedAt != null ? revokedAt.toInstant() : null,
          lastSeen != null ? lastSeen.toInstant() : null
      );
    } catch (java.sql.SQLException e) {
      throw new RuntimeException(e);
    }
  }
}
