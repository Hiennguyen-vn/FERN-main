package com.dorabets.idempotency;

public class IdempotencyInProgressException extends IdempotencyException {
    public IdempotencyInProgressException(String message) {
        super(message);
    }
}
