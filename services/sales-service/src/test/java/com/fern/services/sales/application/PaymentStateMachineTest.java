package com.fern.services.sales.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.dorabets.common.middleware.ServiceException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class PaymentStateMachineTest {

    // ── Valid transitions ─────────────────────────────────────────────────────

    @ParameterizedTest(name = "{0} → {1}")
    @CsvSource({
        "PENDING_OFFLINE, QUEUED",
        "PENDING_OFFLINE, COMPLETED",
        "PENDING_OFFLINE, FAILED",
        "QUEUED,          COMPLETED",
        "QUEUED,          RECONCILED",
        "QUEUED,          FAILED",
        "COMPLETED,       RECONCILED",
        "COMPLETED,       FAILED",
    })
    void validTransitions(String from, String to) {
        assertEquals(to.strip(), PaymentStateMachine.transition(from.strip(), to.strip()));
    }

    // ── Idempotent same-state ─────────────────────────────────────────────────

    @ParameterizedTest(name = "idempotent {0} → {0}")
    @CsvSource({"PENDING_OFFLINE", "QUEUED", "COMPLETED", "RECONCILED", "FAILED"})
    void idempotentSameState(String state) {
        assertEquals(state, PaymentStateMachine.transition(state, state));
    }

    // ── New insert (from == null) ─────────────────────────────────────────────

    @Test
    void newInsertAcceptsAnyTarget() {
        assertEquals("PENDING_OFFLINE", PaymentStateMachine.transition(null, "PENDING_OFFLINE"));
        assertEquals("QUEUED",          PaymentStateMachine.transition(null, "QUEUED"));
        assertEquals("COMPLETED",       PaymentStateMachine.transition(null, "COMPLETED"));
    }

    // ── Illegal transitions ───────────────────────────────────────────────────

    @ParameterizedTest(name = "illegal {0} → {1}")
    @CsvSource({
        "PENDING_OFFLINE, RECONCILED",
        "QUEUED,          PENDING_OFFLINE",
        "COMPLETED,       PENDING_OFFLINE",
        "COMPLETED,       QUEUED",
        "RECONCILED,      COMPLETED",
        "RECONCILED,      FAILED",
        "FAILED,          COMPLETED",
        "FAILED,          QUEUED",
    })
    void illegalTransitionsThrowConflict(String from, String to) {
        ServiceException ex = assertThrows(ServiceException.class,
            () -> PaymentStateMachine.transition(from.strip(), to.strip()));
        assertEquals(409, ex.getStatusCode());
    }

    // ── Unknown from-state ────────────────────────────────────────────────────

    @Test
    void unknownFromStateThrowsConflict() {
        ServiceException ex = assertThrows(ServiceException.class,
            () -> PaymentStateMachine.transition("BOGUS_STATE", "COMPLETED"));
        assertEquals(409, ex.getStatusCode());
    }

    // ── Null target guard ─────────────────────────────────────────────────────

    @Test
    void nullTargetThrowsIllegalArgument() {
        assertThrows(IllegalArgumentException.class,
            () -> PaymentStateMachine.transition("QUEUED", null));
    }
}
