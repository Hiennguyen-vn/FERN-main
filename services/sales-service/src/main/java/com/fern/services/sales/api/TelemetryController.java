package com.fern.services.sales.api;

import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/telemetry")
public class TelemetryController {

    private static final Logger log = LoggerFactory.getLogger(TelemetryController.class);

    private final MeterRegistry meterRegistry;

    public TelemetryController(MeterRegistry meterRegistry) {
        this.meterRegistry = meterRegistry;
    }

    @PostMapping
    public ResponseEntity<Void> ingest(@RequestBody TelemetryDtos.ClientTelemetry body) {
        log.info("client-telemetry device={} outbox_depth={} sync_latency_ms={} failed_events={} sw_activations={}",
            body.deviceId(), body.outboxDepth(), body.syncLatencyMs(),
            body.failedEventCount(), body.swActivationCount());

        meterRegistry.gauge("client_outbox_depth", body, TelemetryDtos.ClientTelemetry::outboxDepth);
        meterRegistry.counter("client_sync_latency_total", "device_id", String.valueOf(body.deviceId()))
            .increment(body.syncLatencyMs());
        meterRegistry.counter("client_failed_events_total", "device_id", String.valueOf(body.deviceId()))
            .increment(body.failedEventCount());
        if (body.swActivationCount() > 0) {
            meterRegistry.counter("client_sw_activations_total").increment(body.swActivationCount());
        }
        return ResponseEntity.noContent().build();
    }
}
