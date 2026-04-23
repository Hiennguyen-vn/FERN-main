package com.fern.services.sales.api;

public class TelemetryDtos {

    public record ClientTelemetry(
        long deviceId,
        int outboxDepth,
        long syncLatencyMs,
        int failedEventCount,
        int swActivationCount
    ) {}
}
