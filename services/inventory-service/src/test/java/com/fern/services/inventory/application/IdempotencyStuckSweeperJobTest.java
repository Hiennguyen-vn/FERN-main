package com.fern.services.inventory.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fern.common.idempotency.IdempotencyGuard;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class IdempotencyStuckSweeperJobTest {

  @Mock
  private IdempotencyGuard guard;

  @Test
  void sweepCallsRecoverStuckWithConfiguredBounds() {
    IdempotencyStuckSweeperJob job = new IdempotencyStuckSweeperJob(guard, 30, 0);
    when(guard.recoverStuck(60, 1)).thenReturn(3);

    job.sweep();

    verify(guard).recoverStuck(60, 1);
  }

  @Test
  void sweepSwallowsGuardFailures() {
    IdempotencyStuckSweeperJob job = new IdempotencyStuckSweeperJob(guard, 300, 200);
    when(guard.recoverStuck(300, 200)).thenThrow(new RuntimeException("db down"));

    job.sweep();
  }
}
