package com.dorabets.idempotency;

public class IdempotencyConflictException extends IdempotencyException {
    public IdempotencyConflictException(String message) {
        super(message);
    }
}
