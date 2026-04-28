package com.fern.services.sales.application;

import com.fern.common.middleware.ServiceException;
import java.util.Map;
import java.util.Set;

/**
 * Guards payment state transitions.
 *
 * Valid transitions:
 *   PENDING_OFFLINE → QUEUED      (central received offline event)
 *   QUEUED          → COMPLETED   (online payment settled)
 *   QUEUED          → RECONCILED  (offline sync matched)
 *   PENDING_OFFLINE → COMPLETED   (direct online settlement)
 *   COMPLETED       → RECONCILED  (end-of-day reconciliation)
 *   ANY             → FAILED      (explicit rejection)
 *
 * Terminal states: RECONCILED, FAILED — no further transitions.
 */
public final class PaymentStateMachine {

    private static final Map<String, Set<String>> ALLOWED = Map.of(
        "PENDING_OFFLINE", Set.of("QUEUED", "COMPLETED", "FAILED"),
        "QUEUED",          Set.of("COMPLETED", "RECONCILED", "FAILED"),
        "COMPLETED",       Set.of("RECONCILED", "FAILED"),
        "RECONCILED",      Set.of(),
        "FAILED",          Set.of()
    );

    private PaymentStateMachine() {}

    /**
     * Returns {@code to} if the transition is valid.
     * If {@code from} is null (new payment row), any non-null target is accepted.
     * Throws {@link ServiceException} (409) on illegal transition.
     */
    public static String transition(String from, String to) {
        if (to == null) throw new IllegalArgumentException("Target state must not be null");
        if (from == null) return to;  // new insert — no prior state to guard
        if (from.equals(to)) return to;  // idempotent same-state update is fine

        Set<String> allowed = ALLOWED.get(from);
        if (allowed == null) {
            throw ServiceException.conflict("Unknown payment state: " + from);
        }
        if (!allowed.contains(to)) {
            throw ServiceException.conflict(
                "Cannot transition payment from " + from + " to " + to);
        }
        return to;
    }
}
