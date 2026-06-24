package com.fern.services.sales.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fern.services.sales.application.CashMovementService;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class CashMovementControllerTest {

  @Mock
  private CashMovementService cashMovementService;

  @InjectMocks
  private CashMovementController controller;

  @Test
  void createDelegatesToCashMovementService() {
    // Given
    CashMovementService.CashMovementRequest request =
        new CashMovementService.CashMovementRequest("PAID_IN", new BigDecimal("150000.00"), "change bank", null, null);
    CashMovementService.CashMovementView expected = movement(3001L);
    when(cashMovementService.record(9001L, request)).thenReturn(expected);

    // When
    CashMovementService.CashMovementView result = controller.create(9001L, request);

    // Then
    assertThat(result).isSameAs(expected);
    verify(cashMovementService).record(9001L, request);
  }

  @Test
  void listReturnsItemsAndCount() {
    // Given
    List<CashMovementService.CashMovementView> items = List.of(movement(3001L), movement(3002L));
    when(cashMovementService.list(9001L)).thenReturn(items);

    // When
    Map<String, Object> result = controller.list(9001L);

    // Then
    assertThat(result).containsEntry("items", items).containsEntry("count", 2);
  }

  @Test
  void summaryDelegatesToCashMovementService() {
    // Given
    Map<String, Object> expected = Map.of("sessionId", 9001L, "variance", BigDecimal.ZERO);
    when(cashMovementService.summary(9001L)).thenReturn(expected);

    // When
    Map<String, Object> result = controller.summary(9001L);

    // Then
    assertThat(result).isSameAs(expected);
    verify(cashMovementService).summary(9001L);
  }

  private static CashMovementService.CashMovementView movement(long id) {
    return new CashMovementService.CashMovementView(
        id,
        9001L,
        5L,
        "PAID_IN",
        new BigDecimal("150000.00"),
        "change bank",
        null,
        77L,
        null,
        Instant.parse("2026-04-03T10:15:30Z")
    );
  }
}
