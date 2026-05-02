package com.fern.common.util;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

import java.util.UUID;
import org.junit.jupiter.api.Test;

class UuidV5Test {

  @Test
  void deterministicForSameOutboxId() {
    UUID a = UuidV5.fromOutboxId(123456789L);
    UUID b = UuidV5.fromOutboxId(123456789L);
    assertEquals(a, b);
  }

  @Test
  void differentForDifferentOutboxId() {
    assertNotEquals(UuidV5.fromOutboxId(1L), UuidV5.fromOutboxId(2L));
  }

  @Test
  void versionIs5() {
    UUID u = UuidV5.fromOutboxId(42L);
    assertEquals(5, u.version());
    assertEquals(2, u.variant()); // RFC 4122
  }
}
