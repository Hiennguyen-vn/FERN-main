package com.fern.services.sales.application;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class SyncServiceRetryClassificationTest {

    @Test
    void paymentBeforeApprovalRejectIsRetryableDependencyFailure() {
        assertTrue(SyncService.isRetryableSyncFailure("Only approved orders can be marked as payment done"));
        assertTrue(SyncService.isRetryableSyncFailure(" Only approved orders can be marked as payment done "));
    }

    @Test
    void businessValidationRejectsRemainTerminal() {
        assertFalse(SyncService.isRetryableSyncFailure("Unsupported payment method"));
        assertFalse(SyncService.isRetryableSyncFailure(null));
        assertFalse(SyncService.isRetryableSyncFailure(""));
    }
}
