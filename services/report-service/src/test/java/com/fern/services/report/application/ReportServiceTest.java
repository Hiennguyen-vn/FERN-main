package com.fern.services.report.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import com.dorabets.common.spring.auth.AuthorizationPolicyService;
import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.dorabets.common.spring.web.PagedResult;
import com.fern.services.report.api.ReportDtos;
import com.fern.services.report.infrastructure.ReportRepository;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class ReportServiceTest {

  @Mock
  private ReportRepository reportRepository;
  @Mock
  private AuthorizationPolicyService authorizationPolicyService;

  @AfterEach
  void clearContext() {
    RequestUserContextHolder.clear();
  }

  @Test
  void salesSummaryAllowsScopedOutletAccess() {
    RequestUserContextHolder.set(new RequestUserContext(
        10L, "user", null, Set.of(), Set.of(), Set.of(7L), true, false, null
    ));
    when(authorizationPolicyService.canReadReport(any(), eq(7L))).thenReturn(true);
    when(reportRepository.salesSummary(
        7L,
        LocalDate.parse("2026-02-25"),
        LocalDate.parse("2026-03-27"),
        null,
        null,
        null,
        50,
        0
    )).thenReturn(PagedResult.of(List.of(new ReportDtos.SalesSummary(
        7L,
        LocalDate.parse("2026-03-27"),
        12L,
        new BigDecimal("150.00"),
        new BigDecimal("10.00"),
        new BigDecimal("5.00"),
        new BigDecimal("145.00")
    )), 50, 0, 1));

    ReportService service = new ReportService(reportRepository, authorizationPolicyService);
    PagedResult<ReportDtos.SalesSummary> result = service.salesSummary(
        7L,
        LocalDate.parse("2026-02-25"),
        LocalDate.parse("2026-03-27"),
        null,
        null,
        null,
        null,
        null
    );

    assertEquals(1, result.items().size());
  }

  @Test
  void lowStockRejectsUnauthorizedOutlet() {
    RequestUserContextHolder.set(new RequestUserContext(
        10L, "user", null, Set.of(), Set.of(), Set.of(8L), true, false, null
    ));

    when(authorizationPolicyService.canReadReport(any(), eq(7L))).thenReturn(false);
    ReportService service = new ReportService(reportRepository, authorizationPolicyService);
    assertThrows(ServiceException.class, () -> service.lowStock(7L, null, null, null, null, null));
  }

  @Test
  void internalServiceBypassesOutletScopeChecks() {
    RequestUserContextHolder.set(new RequestUserContext(
        null, null, null, Set.of(), Set.of(), Set.of(), false, true, "gateway"
    ));
    when(authorizationPolicyService.canReadReport(any(), eq(7L))).thenReturn(true);
    when(reportRepository.lowStock(
        7L,
        null,
        null,
        null,
        50,
        0
    )).thenReturn(PagedResult.of(List.of(new ReportDtos.LowStockSnapshot(
        7L,
        99L,
        "ITEM-99",
        "Milk",
        new BigDecimal("2.0000"),
        new BigDecimal("5.0000")
    )), 50, 0, 1));

    ReportService service = new ReportService(reportRepository, authorizationPolicyService);
    PagedResult<ReportDtos.LowStockSnapshot> result = service.lowStock(7L, null, null, null, null, null);

    assertEquals(1, result.items().size());
    assertEquals(99L, result.items().getFirst().itemId());
  }
}
