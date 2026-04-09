package com.dorabets.idempotency.model;

public enum TtlPolicy {
    BET(86_400),            // 24 hours
    SETTLEMENT(604_800),    // 7 days
    WITHDRAWAL(2_592_000);  // 30 days

    private final long seconds;

    TtlPolicy(long seconds) {
        this.seconds = seconds;
    }

    public long getSeconds() {
        return seconds;
    }
}
