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
import java.time.Instant;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class SupplierPaymentServiceTest {

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
  void postPaymentTransitionsToPostedStatus() {
    RequestUserContextHolder.set(new RequestUserContext(
        null, null, null, Set.of(), Set.of(), Set.of(), false, true, "finance-service"
    ));
    ProcurementDtos.SupplierPaymentView payment = new ProcurementDtos.SupplierPaymentView(
        "100",
        200L,
        "USD",
        "cash",
        java.math.BigDecimal.TEN,
        "pending",
        Instant.parse("2026-03-27T00:00:00Z"),
        null,
        null,
        null,
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-27T00:00:00Z"),
        List.of(new ProcurementDtos.SupplierPaymentAllocationView(300L, java.math.BigDecimal.TEN, null))
    );
    ProcurementDtos.SupplierInvoiceView invoice = new ProcurementDtos.SupplierInvoiceView(
        300L,
        "INV-300",
        400L,
        "USD",
        java.time.LocalDate.parse("2026-03-27"),
        null,
        java.math.BigDecimal.TEN,
        java.math.BigDecimal.ZERO,
        java.math.BigDecimal.TEN,
        "approved",
        null,
        null,
        null,
        null,
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-27T00:00:00Z"),
        List.of(500L),
        List.of()
    );
    ProcurementDtos.GoodsReceiptView receipt = new ProcurementDtos.GoodsReceiptView(
        500L,
        600L,
        "USD",
        Instant.parse("2026-03-27T00:00:00Z"),
        java.time.LocalDate.parse("2026-03-27"),
        "posted",
        null,
        java.math.BigDecimal.TEN,
        null,
        null,
        null,
        null,
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-27T00:00:00Z"),
        List.of()
    );
    ProcurementDtos.PurchaseOrderView po = new ProcurementDtos.PurchaseOrderView(
        600L,
        400L,
        700L,
        "USD",
        java.time.LocalDate.parse("2026-03-27"),
        null,
        java.math.BigDecimal.TEN,
        "approved",
        null,
        null,
        null,
        null,
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-27T00:00:00Z"),
        List.of()
    );

    when(procurementRepository.findSupplierPayment(100L)).thenReturn(java.util.Optional.of(payment));
    when(procurementRepository.findSupplierInvoice(300L)).thenReturn(java.util.Optional.of(invoice));
    when(procurementRepository.findGoodsReceipt(500L)).thenReturn(java.util.Optional.of(receipt));
    when(procurementRepository.findPurchaseOrder(600L)).thenReturn(java.util.Optional.of(po));

    SupplierPaymentService service = new SupplierPaymentService(procurementRepository, idGenerator, permissionMatrixService);
    service.postPayment(100L);

    verify(procurementRepository).updateSupplierPaymentStatus(100L, "posted");
  }

  @Test
  void listPaymentsRejectsRequestedOutletOutsideScope() {
    RequestUserContextHolder.set(new RequestUserContext(
        77L,
        "workflow.user",
        "session-77",
        Set.of(),
        Set.of(),
        Set.of(700L),
        true,
        false,
        null
    ));

    SupplierPaymentService service = new SupplierPaymentService(procurementRepository, idGenerator, permissionMatrixService);
    ServiceException exception = assertThrows(ServiceException.class, () -> service.listPayments(
        701L,
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
  void listPaymentsDelegatesScopedFilterAndLimit() {
    RequestUserContextHolder.set(new RequestUserContext(
        77L,
        "workflow.user",
        "session-77",
        Set.of(),
        Set.of(),
        Set.of(700L),
        true,
        false,
        null
    ));
    when(procurementRepository.listSupplierPayments(
        Set.of(700L),
        400L,
        "posted",
        Instant.parse("2026-03-01T00:00:00Z"),
        Instant.parse("2026-03-31T23:59:59Z"),
        null,
        null,
        null,
        100,
        0
    )).thenReturn(PagedResult.of(List.of(), 100, 0, 0));

    SupplierPaymentService service = new SupplierPaymentService(procurementRepository, idGenerator, permissionMatrixService);
    service.listPayments(
        700L,
        400L,
        "posted",
        Instant.parse("2026-03-01T00:00:00Z"),
        Instant.parse("2026-03-31T23:59:59Z"),
        null,
        null,
        null,
        200,
        null
    );

    verify(procurementRepository).listSupplierPayments(
        Set.of(700L),
        400L,
        "posted",
        Instant.parse("2026-03-01T00:00:00Z"),
        Instant.parse("2026-03-31T23:59:59Z"),
        null,
        null,
        null,
        100,
        0
    );
  }
}
