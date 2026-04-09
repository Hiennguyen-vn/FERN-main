package com.dorabets.common.middleware;

import com.dorabets.idempotency.IdempotencyConflictException;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.javalin.Javalin;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Map;

public final class ErrorHandler {

    private static final Logger log = LoggerFactory.getLogger(ErrorHandler.class);

    private ErrorHandler() {}

    public static void register(Javalin app, ObjectMapper mapper) {
        app.exception(IdempotencyConflictException.class, (e, ctx) -> {
            log.warn("Idempotency conflict: {}", e.getMessage());
            ctx.status(409).json(Map.of("error", "conflict", "message", e.getMessage()));
        });

        app.exception(IllegalArgumentException.class, (e, ctx) -> {
            ctx.status(400).json(Map.of("error", "bad_request", "message", e.getMessage()));
        });

        app.exception(ServiceException.class, (e, ctx) -> {
            log.error("Service error: {}", e.getMessage(), e);
            ctx.status(e.getStatusCode()).json(Map.of("error", e.getErrorCode(), "message", e.getMessage()));
        });

        app.exception(Exception.class, (e, ctx) -> {
            log.error("Unhandled exception", e);
            ctx.status(500).json(Map.of("error", "internal_error", "message", "An unexpected error occurred"));
        });
    }
}
