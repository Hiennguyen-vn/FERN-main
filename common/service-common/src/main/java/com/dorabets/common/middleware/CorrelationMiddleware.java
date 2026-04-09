package com.dorabets.common.middleware;

import io.javalin.Javalin;

import java.util.UUID;

/**
 * Injects trace_id and request_id into every request for distributed tracing.
 */
public final class CorrelationMiddleware {

    public static final String TRACE_ID = "X-Trace-Id";
    public static final String REQUEST_ID = "X-Request-Id";

    private CorrelationMiddleware() {}

    public static void register(Javalin app) {
        app.before(ctx -> {
            String traceId = ctx.header(TRACE_ID);
            if (traceId == null || traceId.isBlank()) {
                traceId = UUID.randomUUID().toString();
            }
            ctx.attribute("trace_id", traceId);
            ctx.attribute("request_id", UUID.randomUUID().toString());
            ctx.header(TRACE_ID, traceId);
            ctx.header(REQUEST_ID, ctx.attribute("request_id"));
        });

        app.after(ctx -> {
            String traceId = ctx.attribute("trace_id");
            String requestId = ctx.attribute("request_id");
            if (traceId != null) ctx.header(TRACE_ID, traceId);
            if (requestId != null) ctx.header(REQUEST_ID, requestId);
        });
    }
}
