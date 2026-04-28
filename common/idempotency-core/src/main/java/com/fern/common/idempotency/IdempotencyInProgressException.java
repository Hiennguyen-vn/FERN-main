package com.fern.common.idempotency;

public class IdempotencyInProgressException extends IdempotencyException {
    public IdempotencyInProgressException(String message) {
        super(message);
    }
}
