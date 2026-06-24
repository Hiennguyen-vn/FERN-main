package com.fern.services.sales.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fern.common.spring.auth.RequestUserContext;
import com.fern.common.spring.auth.RequestUserContextHolder;
import com.fern.services.sales.application.CashMovementService;
import com.fern.services.sales.infrastructure.SalesRepository;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class AdminReportsControllerTest {

  @Mock
  private SalesRepository salesRepository;

  @Mock
  private CashMovementService cashMovementService;

  @InjectMocks
  private AdminReportsController controller;

  @AfterEach
  void clearContext() {
    RequestUserContextHolder.clear();
  }

  @Test
  void cashSummaryDelegatesToCashMovementService() {
    // Given
    Map<String, Object> expected = Map.of("sessionId", 7001L, "variance", "0.00");
    when(cashMovementService.summary(7001L)).thenReturn(expected);

    // When
    Map<String, Object> result = controller.cashSummary(7001L);

    // Then
    assertThat(result).isSameAs(expected);
    verify(cashMovementService).summary(7001L);
  }

  @Test
  void dltListClampsLimitAndReturnsCount() {
    // Given
    List<Map<String, Object>> pending = List.of(
        Map.of("id", 11L, "topic", "sales.completed"),
        Map.of("id", 12L, "topic", "inventory.reserve")
    );
    when(salesRepository.listDltPending(1)).thenReturn(pending);

    // When
    Map<String, Object> result = controller.dltList(-50);

    // Then
    assertThat(result)
        .containsEntry("items", pending)
        .containsEntry("count", 2);
    verify(salesRepository).listDltPending(1);
  }

  @Test
  void dltReplayReportsWhetherEventWasRequeued() {
    // Given
    when(salesRepository.requeueDlt(99L)).thenReturn(0);
    when(salesRepository.requeueDlt(100L)).thenReturn(1);

    // When
    Map<String, Object> missing = controller.dltReplay(99L);
    Map<String, Object> replayed = controller.dltReplay(100L);

    // Then
    assertThat(missing).containsEntry("eventId", 99L).containsEntry("requeued", false);
    assertThat(replayed).containsEntry("eventId", 100L).containsEntry("requeued", true);
  }

  @Test
  void priceDriftUsesRequestedOutletsWhenNoReadableScopeExists() {
    // Given
    List<Map<String, Object>> rows = List.of(Map.of("productId", 501L, "drift", "3500"));
    when(salesRepository.reportPriceDrift(
        List.of(7L, 8L),
        Instant.parse("2026-04-01T00:00:00Z"),
        Instant.parse("2026-04-02T00:00:00Z"),
        500
    )).thenReturn(rows);

    // When
    Map<String, Object> result = controller.priceDrift(
        List.of(7L, 8L),
        "2026-04-01T00:00:00Z",
        "2026-04-02T00:00:00Z",
        7000
    );

    // Then
    assertThat(result).containsEntry("items", rows).containsEntry("count", 1);
    verify(salesRepository).reportPriceDrift(
        List.of(7L, 8L),
        Instant.parse("2026-04-01T00:00:00Z"),
        Instant.parse("2026-04-02T00:00:00Z"),
        500
    );
  }

  @Test
  void priceDriftFiltersRequestedOutletsByReadableScopeAndSkipsEmptyResult() {
    // Given
    RequestUserContextHolder.set(new RequestUserContext(
        55L, "auditor", "s-55", Set.of("auditor"), Set.of("sales:read"), Set.of(7L),
        true, false, null, null, null));

    // When
    Map<String, Object> result = controller.priceDrift(
        List.of(8L),
        "2026-04-01T00:00:00Z",
        "2026-04-02T00:00:00Z",
        25
    );

    // Then
    assertThat(result)
        .containsEntry("items", List.of())
        .containsEntry("count", 0);
  }
}
