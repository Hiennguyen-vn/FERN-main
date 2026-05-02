package com.fern.common.util;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.UUID;

/**
 * Deterministic UUIDv5 derivation (RFC 4122 §4.3) under FERN namespace.
 * Used to derive stable wire-level eventId from outbox row id so that
 * relay reclaim / retry produces identical envelope.eventId.
 */
public final class UuidV5 {

  /** FERN namespace UUID — fixed constant; do not rotate. */
  public static final UUID FERN_OUTBOX_NAMESPACE =
      UUID.fromString("e8a3b2d4-1c5f-5e6d-8a4b-9f0c1d2e3f40");

  private UuidV5() {}

  /**
   * Derive a UUIDv5 from an outbox row id under FERN_OUTBOX_NAMESPACE.
   * Same input ⇒ same UUID, every time.
   */
  public static UUID fromOutboxId(long outboxId) {
    return fromName(FERN_OUTBOX_NAMESPACE, "outbox:" + outboxId);
  }

  public static UUID fromName(UUID namespace, String name) {
    if (namespace == null || name == null) {
      throw new IllegalArgumentException("namespace and name required");
    }
    try {
      MessageDigest sha1 = MessageDigest.getInstance("SHA-1");
      sha1.update(uuidToBytes(namespace));
      sha1.update(name.getBytes(StandardCharsets.UTF_8));
      byte[] hash = sha1.digest();
      // Set version to 5
      hash[6] = (byte) ((hash[6] & 0x0f) | 0x50);
      // Set IETF variant (10xx)
      hash[8] = (byte) ((hash[8] & 0x3f) | 0x80);
      ByteBuffer bb = ByteBuffer.wrap(hash, 0, 16);
      long msb = bb.getLong();
      long lsb = bb.getLong();
      return new UUID(msb, lsb);
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException("SHA-1 unavailable", e);
    }
  }

  private static byte[] uuidToBytes(UUID uuid) {
    ByteBuffer bb = ByteBuffer.allocate(16);
    bb.putLong(uuid.getMostSignificantBits());
    bb.putLong(uuid.getLeastSignificantBits());
    return bb.array();
  }
}
