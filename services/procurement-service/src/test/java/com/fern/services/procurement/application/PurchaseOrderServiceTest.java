package com.fern.services.procurement.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.PermissionMatrixService;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.dorabets.common.spring.web.PagedResult;
import com.fern.services.procurement.api.ProcurementDtos;
import com.fern.services.procurement.infrastructure.ProcurementRepository;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class PurchaseOrderServiceTest {

  @Mock
  private ProcurementRepository procurementRepository;
  @Mock
  private SnowflakeIdGenerator idGenerator;
  @Mock
  private PermissionMatrixService permissionMatrixService;

  @AfterEach
  void clearContext() {
    RequestUserContextHolder.clear();
  }

  @Test
  void approvePurchaseOrderDelegatesToRepository() {
    RequestUserContextHolder.set(new RequestUserContext(
        null, null, null, Set.of(), Set.of(), Set.of(), false, true, "finance-service"
    ));
    ProcurementDtos.PurchaseOrderView draft = new ProcurementDtos.PurchaseOrderView(
        600L,
        400L,
        700L,
        "USD",
        LocalDate.parse("2026-03-27"),
        null,
        new BigDecimal("10.00"),
        "draft",
        null,
        9L,
        null,
        null,
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-27T00:00:00Z"),
        List.of()
    );
    ProcurementDtos.PurchaseOrderView approved = new ProcurementDtos.PurchaseOrderView(
        600L,
        400L,
        700L,
        "USD",
        LocalDate.parse("2026-03-27"),
        null,
        new BigDecimal("10.00"),
        "approved",
        null,
        9L,
        9L,
        Instant.parse("2026-03-27T00:05:00Z"),
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-27T00:05:00Z"),
        List.of()
    );
    when(procurementRepository.findPurchaseOrder(600L)).thenReturn(java.util.Optional.of(draft));
    when(procurementRepository.approvePurchaseOrder(600L, null)).thenReturn(approved);

    PurchaseOrderService service = new PurchaseOrderService(procurementRepository, idGenerator, permissionMatrixService);
    ProcurementDtos.PurchaseOrderView result = service.approvePurchaseOrder(600L);

    verify(procurementRepository).approvePurchaseOrder(600L, null);
    assertEquals("approved", result.status());
  }

  @Test
  void listPurchaseOrdersRejectsRequestedOutletOutsideScope() {
    RequestUserContextHolder.set(new RequestUserContext(
        12L, "manager", "sess-12", Set.of("outlet_manager"), Set.of(), Set.of(2000L), true, false, null
    ));
    PurchaseOrderService service = new PurchaseOrderService(procurementRepository, idGenerator, permissionMatrixService);

    ServiceException exception = assertThrows(ServiceException.class, () -> service.listPurchaseOrders(
        2001L,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        20,
        0
    ));

    assertEquals(403, exception.getStatusCode());
  }

  @Test
  void listPurchaseOrdersDelegatesLimitAndOutletScope() {
    RequestUserContextHolder.set(new RequestUserContext(
        12L, "manager", "sess-12", Set.of("outlet_manager"), Set.of(), Set.of(2000L), true, false, null
    ));
    when(procurementRepository.listPurchaseOrders(
        Set.of(2000L),
        6000L,
        "approved",
        LocalDate.parse("2024-03-01"),
        LocalDate.parse("2024-03-31"),
        null,
        null,
        null,
        100,
        0
    )).thenReturn(PagedResult.of(List.of(), 100, 0, 0));

    PurchaseOrderService service = new PurchaseOrderService(procurementRepository, idGenerator, permissionMatrixService);
    service.listPurchaseOrders(
        2000L,
        6000L,
        "approved",
        LocalDate.parse("2024-03-01"),
        LocalDate.parse("2024-03-31"),
        null,
        null,
        null,
        500,
        null
    );

    verify(procurementRepository).listPurchaseOrders(
        Set.of(2000L),
        6000L,
        "approved",
        LocalDate.parse("2024-03-01"),
        LocalDate.parse("2024-03-31"),
        null,
        null,
        null,
        100,
        0
    );
  }
}
