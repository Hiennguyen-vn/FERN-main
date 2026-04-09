package com.fern.simulator.model;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Map;

/**
 * A structured simulation event recorded in the event journal.
 */
public record SimEvent(
        LocalDate date,
        Instant timestamp,
        String eventType,
        String regionCode,
        Long outletId,
        Map<String, Object> details
) {
    public static SimEvent of(LocalDate date, String eventType, String regionCode, Long outletId,
                               Map<String, Object> details) {
        return new SimEvent(date, Instant.now(), eventType, regionCode, outletId, details);
    }

    public static SimEvent of(LocalDate date, String eventType, Map<String, Object> details) {
        return new SimEvent(date, Instant.now(), eventType, null, null, details);
    }
}
