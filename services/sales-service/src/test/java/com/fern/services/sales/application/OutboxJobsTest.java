package com.fern.services.sales.application;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import com.fern.common.outbox.OutboxDlqForwarder;
import com.fern.common.outbox.OutboxRelay;
import org.junit.jupiter.api.Test;

class OutboxJobsTest {

  @Test
  void drainJobDelegatesAndSwallowsRuntimeFailures() {
    OutboxRelay relay = mock(OutboxRelay.class);
    OutboxDrainJob job = new OutboxDrainJob(relay);

    job.drain();
    verify(relay).drain();

    OutboxRelay failingRelay = mock(OutboxRelay.class);
    doThrow(new RuntimeException("kafka unavailable")).when(failingRelay).drain();
    assertDoesNotThrow(() -> new OutboxDrainJob(failingRelay).drain());
    verify(failingRelay).drain();
  }

  @Test
  void dlqForwarderJobDelegatesAndSwallowsRuntimeFailures() {
    OutboxDlqForwarder forwarder = mock(OutboxDlqForwarder.class);
    OutboxDlqForwarderJob job = new OutboxDlqForwarderJob(forwarder);

    job.drain();
    verify(forwarder).drain();

    OutboxDlqForwarder failingForwarder = mock(OutboxDlqForwarder.class);
    doThrow(new RuntimeException("dlq unavailable")).when(failingForwarder).drain();
    assertDoesNotThrow(() -> new OutboxDlqForwarderJob(failingForwarder).drain());
    verify(failingForwarder).drain();
  }
}
