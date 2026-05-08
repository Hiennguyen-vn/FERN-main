package com.fern.services.sales.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fern.common.idempotency.IdempotencyGuard;
import org.junit.jupiter.api.Test;

class IdempotencyStuckSweeperJobTest {

  @Test
  void sweepLogsAndDelegatesWhenStuckRowsExist() {
    IdempotencyGuard guard = mock(IdempotencyGuard.class);
    when(guard.recoverStuck(anyInt(), anyInt())).thenReturn(3);

    IdempotencyStuckSweeperJob job = new IdempotencyStuckSweeperJob(guard, 300, 200);
    job.sweep();

    verify(guard, times(1)).recoverStuck(300, 200);
  }

  @Test
  void sweepClampsStalenessBelowMinimum() {
    IdempotencyGuard guard = mock(IdempotencyGuard.class);
    when(guard.recoverStuck(anyInt(), anyInt())).thenReturn(0);

    // stalenessSeconds < 60 → clamped to 60
    IdempotencyStuckSweeperJob job = new IdempotencyStuckSweeperJob(guard, 10, 50);
    job.sweep();

    verify(guard, times(1)).recoverStuck(60, 50);
  }

  @Test
  void sweepToleratesGuardException() {
    IdempotencyGuard guard = mock(IdempotencyGuard.class);
    when(guard.recoverStuck(anyInt(), anyInt()))
        .thenThrow(new RuntimeException("DB unavailable"));

    IdempotencyStuckSweeperJob job = new IdempotencyStuckSweeperJob(guard, 300, 200);
    // Must not propagate — sweep failure should never crash the scheduler thread.
    job.sweep();

    verify(guard, times(1)).recoverStuck(anyInt(), anyInt());
  }
}
