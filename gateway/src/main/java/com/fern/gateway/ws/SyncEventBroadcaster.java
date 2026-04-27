package com.fern.gateway.ws;

import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Sinks;

/**
 * Per-outlet broadcast bus. Services call {@link #publish} to push an event to all
 * WebSocket sessions currently watching that outlet.
 */
@Component
public class SyncEventBroadcaster {

    // One multicast sink per outlet — created lazily, never removed (low cardinality: 5-20 outlets).
    private final ConcurrentHashMap<Long, Sinks.Many<String>> sinks = new ConcurrentHashMap<>();

    private Sinks.Many<String> sinkFor(long outletId) {
        return sinks.computeIfAbsent(outletId, id ->
            Sinks.many().multicast().onBackpressureBuffer(64, false));
    }

    /**
     * Subscribe to the event stream for a given outlet.
     * Each WebSocket session calls this once and pipes the Flux to the session.
     */
    public Flux<String> subscribe(long outletId) {
        return sinkFor(outletId).asFlux();
    }

    /**
     * Publish an event JSON string to all sessions watching {@code outletId}.
     * Safe to call from any thread (Sinks.many().multicast() is thread-safe).
     */
    public void publish(long outletId, String eventJson) {
        Sinks.Many<String> sink = sinks.get(outletId);
        if (sink != null) {
            sink.tryEmitNext(eventJson);
        }
    }

    /** Convenience: broadcast same event to every connected outlet. */
    public void publishAll(String eventJson) {
        sinks.forEach((id, sink) -> sink.tryEmitNext(eventJson));
    }
}
