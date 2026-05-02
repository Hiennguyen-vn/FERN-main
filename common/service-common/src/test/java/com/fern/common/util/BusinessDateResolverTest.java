package com.fern.common.util;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import org.junit.jupiter.api.Test;

class BusinessDateResolverTest {

  private static final ZoneId VN = ZoneId.of("Asia/Ho_Chi_Minh");

  @Test
  void preCutoffRollsBackToYesterday() {
    // 02:30 local = before 03:00 cutoff ⇒ belongs to yesterday
    Instant t = LocalDate.of(2026, 5, 2).atTime(2, 30).atZone(VN).toInstant();
    assertEquals(LocalDate.of(2026, 5, 1), BusinessDateResolver.resolve(t, VN));
  }

  @Test
  void postCutoffStaysToday() {
    Instant t = LocalDate.of(2026, 5, 2).atTime(10, 0).atZone(VN).toInstant();
    assertEquals(LocalDate.of(2026, 5, 2), BusinessDateResolver.resolve(t, VN));
  }

  @Test
  void midnightExactRollsBackOneDay() {
    Instant t = LocalDate.of(2026, 5, 2).atTime(0, 0).atZone(VN).toInstant();
    assertEquals(LocalDate.of(2026, 5, 1), BusinessDateResolver.resolve(t, VN));
  }

  @Test
  void customCutoffRespected() {
    // cutoff=6h ⇒ 05:00 local = yesterday
    Instant t = LocalDate.of(2026, 5, 2).atTime(5, 0).atZone(VN).toInstant();
    assertEquals(LocalDate.of(2026, 5, 1),
        BusinessDateResolver.resolve(t, VN, Duration.ofHours(6)));
  }

  @Test
  void nullTimezoneFallsBackToUtc() {
    Instant t = Instant.parse("2026-05-02T01:00:00Z");
    assertEquals(LocalDate.of(2026, 5, 1), BusinessDateResolver.resolve(t, null));
  }
}
