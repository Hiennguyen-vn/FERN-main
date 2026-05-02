package com.fern.services.sales.api;

import com.fern.common.middleware.ServiceException;
import com.fern.common.spring.auth.RequestUserContext;
import com.fern.common.spring.auth.RequestUserContextHolder;
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

    private static void requireDeviceContext() {
        RequestUserContext ctx = RequestUserContextHolder.get();
        if (ctx == null || !ctx.isDeviceContext()) {
            throw ServiceException.forbidden("Telemetry ingest requires device JWT");
        }
    }

    @PostMapping
    public ResponseEntity<Void> ingest(@RequestBody TelemetryDtos.ClientTelemetry body) {
        requireDeviceContext();
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
        if (body.oldestPendingAgeSeconds() != null) {
            meterRegistry.gauge("client_oldest_pending_age_seconds",
                java.util.List.of(io.micrometer.core.instrument.Tag.of("device_id", String.valueOf(body.deviceId()))),
                body.oldestPendingAgeSeconds());
        }
        if (body.recipeVersion() != null) {
            meterRegistry.gauge("client_recipe_version",
                java.util.List.of(io.micrometer.core.instrument.Tag.of("device_id", String.valueOf(body.deviceId()))),
                body.recipeVersion());
        }
        if (body.manifestKid() != null && !body.manifestKid().isBlank()) {
            // Track per-kid presence for fleet-wide kid drift alert.
            meterRegistry.counter("client_manifest_kid_seen_total",
                "device_id", String.valueOf(body.deviceId()),
                "kid", body.manifestKid()).increment();
        }
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/storage-warning")
    public ResponseEntity<Void> storageWarning(@RequestBody java.util.Map<String, Object> body) {
        requireDeviceContext();
        Object outletId = body.getOrDefault("outletId", "unknown");
        Object deviceId = body.getOrDefault("deviceId", "unknown");
        Object ratio    = body.getOrDefault("storageRatio", 0);
        log.warn("client-storage-warning outlet={} device={} ratio={}", outletId, deviceId, ratio);
        double r = 0;
        try { r = Double.parseDouble(ratio.toString()); } catch (Exception ignored) {}
        meterRegistry.gauge("dexie_storage_usage_ratio",
            java.util.List.of(io.micrometer.core.instrument.Tag.of("outlet_id", outletId.toString())),
            r);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/clock-skew")
    public ResponseEntity<Void> clockSkew(@RequestBody java.util.Map<String, Object> body) {
        requireDeviceContext();
        Object outletId = body.getOrDefault("outletId", "unknown");
        Object skewSec  = body.getOrDefault("skewSeconds", 0);
        double s = 0;
        try { s = Double.parseDouble(skewSec.toString()); } catch (Exception ignored) {}
        meterRegistry.summary("client_clock_skew_seconds", "outlet_id", outletId.toString())
            .record(Math.abs(s));
        return ResponseEntity.noContent().build();
    }
}
