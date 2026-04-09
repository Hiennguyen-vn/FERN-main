package com.dorabets.idempotency.model;

public record IdempotencyResult(
        boolean replay,
        int responseCode,
        String responseBody,
        String resourceId
) {
    public static IdempotencyResult ok(String body, String resourceId) {
        return new IdempotencyResult(false, 200, body, resourceId);
    }

    public static IdempotencyResult created(String body, String resourceId) {
        return new IdempotencyResult(false, 201, body, resourceId);
    }
}
