package com.fern.common.spring.auth;

import com.fern.common.middleware.ServiceException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.HexFormat;
import javax.sql.DataSource;

public class DeviceTokenRegistry {

  private final DataSource dataSource;
  private final Clock clock;

  public DeviceTokenRegistry(DataSource dataSource, Clock clock) {
    this.dataSource = dataSource;
    this.clock = clock;
  }

  public void requireActiveDevice(JwtClaims claims, String rawToken) {
    if (claims == null || !claims.isDeviceToken() || rawToken == null || rawToken.isBlank()) {
      throw ServiceException.unauthorized("Device JWT required");
    }
    String tokenHash = sha256(rawToken);
    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement("""
             SELECT outlet_id, token_hash, token_expires_at, revoked_at
             FROM core.device_registry
             WHERE id = ?
             LIMIT 1
             """)) {
      ps.setLong(1, claims.deviceId());
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) {
          throw ServiceException.unauthorized("Device revoked or not found");
        }
        long outletId = rs.getLong("outlet_id");
        String registeredHash = rs.getString("token_hash");
        Timestamp tokenExpiresAt = rs.getTimestamp("token_expires_at");
        Timestamp revokedAt = rs.getTimestamp("revoked_at");
        if (revokedAt != null) {
          throw ServiceException.unauthorized("Device revoked");
        }
        if (outletId != claims.deviceOutletId()) {
          throw ServiceException.unauthorized("Device outlet mismatch");
        }
        if (registeredHash == null || !MessageDigest.isEqual(
            registeredHash.getBytes(StandardCharsets.UTF_8),
            tokenHash.getBytes(StandardCharsets.UTF_8))) {
          throw ServiceException.unauthorized("Device token is no longer active");
        }
        Instant now = clock.instant();
        if (tokenExpiresAt == null || !tokenExpiresAt.toInstant().isAfter(now)) {
          throw ServiceException.unauthorized("Device token expired");
        }
      }
    } catch (ServiceException ex) {
      throw ex;
    } catch (Exception ex) {
      throw ServiceException.unauthorized("Unable to validate device token");
    }
  }

  private static String sha256(String input) {
    try {
      MessageDigest md = MessageDigest.getInstance("SHA-256");
      byte[] hash = md.digest(input.getBytes(StandardCharsets.UTF_8));
      return HexFormat.of().formatHex(hash);
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }
}
