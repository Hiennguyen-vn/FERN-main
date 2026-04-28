package com.fern.common.idempotency;

public class IdempotencyConflictException extends IdempotencyException {
    public IdempotencyConflictException(String message) {
        super(message);
    }
}
