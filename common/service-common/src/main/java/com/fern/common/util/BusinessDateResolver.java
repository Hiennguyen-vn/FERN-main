package com.fern.common.util;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;

/**
 * Resolves outlet-local business date from instant + outlet timezone + cutoff.
 * Cutoff = local hours after midnight that still belong to the previous business day
 * (e.g. cutoff=3h ⇒ sales at 02:30 local roll into yesterday's business date).
 *
 * No DB schema change required — caller passes outlet timezone from core.region.timezone_name.
 */
public final class BusinessDateResolver {

  public static final Duration DEFAULT_CUTOFF = Duration.ofHours(3);

  private BusinessDateResolver() {}

  public static LocalDate resolve(Instant instant, ZoneId outletTimezone, Duration cutoff) {
    if (instant == null) throw new IllegalArgumentException("instant required");
    if (outletTimezone == null) outletTimezone = ZoneId.of("UTC");
    if (cutoff == null) cutoff = DEFAULT_CUTOFF;
    return instant.atZone(outletTimezone).minus(cutoff).toLocalDate();
  }

  public static LocalDate resolve(Instant instant, ZoneId outletTimezone) {
    return resolve(instant, outletTimezone, DEFAULT_CUTOFF);
  }
}
