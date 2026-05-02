package com.fern.services.sales.api;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

public class TelemetryDtos {

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ClientTelemetry(
        long deviceId,
        int outboxDepth,
        long syncLatencyMs,
        int failedEventCount,
        int swActivationCount,
        Long oldestPendingAgeSeconds,
        Long recipeVersion,
        String manifestKid,
        String appVersion
    ) {
        // Backward-compat ctor — older clients omit context fields.
        public ClientTelemetry(long deviceId, int outboxDepth, long syncLatencyMs,
                               int failedEventCount, int swActivationCount) {
            this(deviceId, outboxDepth, syncLatencyMs, failedEventCount, swActivationCount,
                 null, null, null, null);
        }
    }
}
