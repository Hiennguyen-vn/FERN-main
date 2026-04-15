package com.fern.services.procurement.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.AuthorizationPolicyService;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.dorabets.common.spring.events.TypedKafkaEventPublisher;
import com.dorabets.common.spring.web.PagedResult;
import com.fern.events.procurement.InvoiceApprovedEvent;
import com.fern.services.procurement.api.ProcurementDtos;
import com.fern.services.procurement.infrastructure.ProcurementRepository;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class SupplierInvoiceServiceTest {

  @Mock
  private ProcurementRepository procurementRepository;
  @Mock
  private SnowflakeIdGenerator idGenerator;
  @Mock
  private AuthorizationPolicyService authorizationPolicyService;
  @Mock
  private TypedKafkaEventPublisher eventPublisher;

  private final Clock clock = Clock.fixed(Instant.parse("2026-03-27T00:00:00Z"), ZoneOffset.UTC);

  @AfterEach
  void clearContext() {
    RequestUserContextHolder.clear();
  }

  @Test
  void approveInvoicePublishesFinanceEvent() {
    RequestUserContextHolder.set(new RequestUserContext(
        null, null, null, Set.of(), Set.of(), Set.of(), false, true, "finance-service"
    ));
    when(authorizationPolicyService.canWriteProcurement(any(), anyLong())).thenReturn(true);
    ProcurementDtos.SupplierInvoiceView invoice = new ProcurementDtos.SupplierInvoiceView(
        300L,
        "INV-300",
        400L,
        "USD",
        LocalDate.parse("2026-03-27"),
        null,
        new BigDecimal("10.00"),
        BigDecimal.ZERO,
        new BigDecimal("10.00"),
        "approved",
        null,
        9L,
        9L,
        Instant.parse("2026-03-27T00:00:00Z"),
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
        LocalDate.parse("2026-03-27"),
        "posted",
        null,
        new BigDecimal("10.00"),
        null,
        9L,
        9L,
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-27T00:00:00Z"),
        List.of()
    );
    ProcurementDtos.PurchaseOrderView po = new ProcurementDtos.PurchaseOrderView(
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
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-27T00:00:00Z"),
        List.of()
    );
    when(procurementRepository.findSupplierInvoice(300L)).thenReturn(java.util.Optional.of(invoice));
    when(procurementRepository.findGoodsReceipt(500L)).thenReturn(java.util.Optional.of(receipt));
    when(procurementRepository.findPurchaseOrder(600L)).thenReturn(java.util.Optional.of(po));
    when(procurementRepository.approveSupplierInvoice(300L, null)).thenReturn(invoice);

    SupplierInvoiceService service = new SupplierInvoiceService(
        procurementRepository,
        idGenerator,
        authorizationPolicyService,
        eventPublisher,
        clock
    );
    InvoiceApprovedEvent event = service.approveInvoice(300L);

    verify(eventPublisher).publish(
        eq("fern.procurement.invoice-approved"),
        eq("300"),
        eq("procurement.invoice-approved"),
        any(InvoiceApprovedEvent.class)
    );
    assertEquals(300L, event.supplierInvoiceId());
    assertEquals(List.of(500L), event.linkedReceiptIds());
  }

  @Test
  void approveInvoiceRejectsUnauthorizedCallerBeforeMutation() {
    RequestUserContextHolder.set(new RequestUserContext(
        91L,
        "workflow.user",
        "session-91",
        Set.of(),
        Set.of(),
        Set.of(700L),
        true,
        false,
        null
    ));
    ProcurementDtos.SupplierInvoiceView invoice = new ProcurementDtos.SupplierInvoiceView(
        300L,
        "INV-300",
        400L,
        "USD",
        LocalDate.parse("2026-03-27"),
        null,
        new BigDecimal("10.00"),
        BigDecimal.ZERO,
        new BigDecimal("10.00"),
        "draft",
        null,
        9L,
        9L,
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-27T00:00:00Z"),
        null,
        List.of(500L),
        List.of()
    );
    ProcurementDtos.GoodsReceiptView receipt = new ProcurementDtos.GoodsReceiptView(
        500L,
        600L,
        "USD",
        Instant.parse("2026-03-27T00:00:00Z"),
        LocalDate.parse("2026-03-27"),
        "posted",
        null,
        new BigDecimal("10.00"),
        null,
        9L,
        9L,
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-27T00:00:00Z"),
        List.of()
    );
    ProcurementDtos.PurchaseOrderView po = new ProcurementDtos.PurchaseOrderView(
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
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-27T00:00:00Z"),
        List.of()
    );
    when(procurementRepository.findSupplierInvoice(300L)).thenReturn(java.util.Optional.of(invoice));
    when(procurementRepository.findGoodsReceipt(500L)).thenReturn(java.util.Optional.of(receipt));
    when(procurementRepository.findPurchaseOrder(600L)).thenReturn(java.util.Optional.of(po));
    when(authorizationPolicyService.canWriteProcurement(any(), eq(700L))).thenReturn(false);

    SupplierInvoiceService service = new SupplierInvoiceService(
        procurementRepository,
        idGenerator,
        authorizationPolicyService,
        eventPublisher,
        clock
    );

    ServiceException exception = assertThrows(ServiceException.class, () -> service.approveInvoice(300L));

    assertEquals(403, exception.getStatusCode());
    verify(procurementRepository).findSupplierInvoice(300L);
    verify(procurementRepository).findGoodsReceipt(500L);
    verify(procurementRepository).findPurchaseOrder(600L);
    verify(procurementRepository, never()).approveSupplierInvoice(300L, 91L);
    verifyNoInteractions(eventPublisher);
  }

  @Test
  void listInvoicesRejectsRequestedOutletOutsideScope() {
    RequestUserContextHolder.set(new RequestUserContext(
        91L,
        "workflow.user",
        "session-91",
        Set.of(),
        Set.of(),
        Set.of(700L),
        true,
        false,
        null
    ));
    when(authorizationPolicyService.resolveProcurementReadableOutletIds(any())).thenReturn(Set.of(700L));
    SupplierInvoiceService service = new SupplierInvoiceService(
        procurementRepository,
        idGenerator,
        authorizationPolicyService,
        eventPublisher,
        clock
    );

    ServiceException exception = assertThrows(ServiceException.class, () -> service.listInvoices(
        701L,
        null,
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
  void listInvoicesDelegatesScopedFilterAndLimit() {
    RequestUserContextHolder.set(new RequestUserContext(
        91L,
        "workflow.user",
        "session-91",
        Set.of(),
        Set.of(),
        Set.of(700L),
        true,
        false,
        null
    ));
    when(authorizationPolicyService.resolveProcurementReadableOutletIds(any())).thenReturn(Set.of(700L));
    when(procurementRepository.listSupplierInvoices(
        Set.of(700L),
        400L,
        "approved",
        LocalDate.parse("2026-03-01"),
        LocalDate.parse("2026-03-31"),
        LocalDate.parse("2026-04-05"),
        null,
        null,
        null,
        100,
        0
    )).thenReturn(PagedResult.of(List.of(), 100, 0, 0));

    SupplierInvoiceService service = new SupplierInvoiceService(
        procurementRepository,
        idGenerator,
        authorizationPolicyService,
        eventPublisher,
        clock
    );
    service.listInvoices(
        700L,
        400L,
        "approved",
        LocalDate.parse("2026-03-01"),
        LocalDate.parse("2026-03-31"),
        LocalDate.parse("2026-04-05"),
        null,
        null,
        null,
        200,
        null
    );

    verify(procurementRepository).listSupplierInvoices(
        Set.of(700L),
        400L,
        "approved",
        LocalDate.parse("2026-03-01"),
        LocalDate.parse("2026-03-31"),
        LocalDate.parse("2026-04-05"),
        null,
        null,
        null,
        100,
        0
    );
  }
}
