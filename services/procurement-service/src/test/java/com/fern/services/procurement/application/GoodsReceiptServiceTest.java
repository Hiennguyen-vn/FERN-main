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
import com.fern.events.procurement.GoodsReceiptPostedEvent;
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
class GoodsReceiptServiceTest {

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
  void postGoodsReceiptPublishesInventoryEvent() {
    RequestUserContextHolder.set(new RequestUserContext(
        null, null, null, Set.of(), Set.of(), Set.of(), false, true, "finance-service"
    ));
    when(authorizationPolicyService.canWriteProcurement(any(), anyLong())).thenReturn(true);
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
        List.of(new ProcurementDtos.GoodsReceiptItemView(
            1L,
            99L,
            "kg",
            new BigDecimal("2.0000"),
            new BigDecimal("5.00"),
            new BigDecimal("10.00"),
            null,
            null,
            null
        ))
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
    when(procurementRepository.findGoodsReceipt(500L)).thenReturn(java.util.Optional.of(receipt));
    when(procurementRepository.findPurchaseOrder(600L)).thenReturn(java.util.Optional.of(po));
    when(procurementRepository.postGoodsReceipt(500L)).thenReturn(receipt);

    GoodsReceiptService service = new GoodsReceiptService(
        procurementRepository,
        idGenerator,
        authorizationPolicyService,
        eventPublisher,
        clock
    );
    GoodsReceiptPostedEvent event = service.postGoodsReceipt(500L);

    verify(eventPublisher).publish(
        eq("fern.procurement.goods-receipt-posted"),
        eq("500"),
        eq("procurement.goods-receipt-posted"),
        any(GoodsReceiptPostedEvent.class)
    );
    assertEquals(500L, event.goodsReceiptId());
    assertEquals(700L, event.outletId());
  }

  @Test
  void postGoodsReceiptRejectsUnauthorizedCallerBeforeMutation() {
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
    ProcurementDtos.GoodsReceiptView receipt = new ProcurementDtos.GoodsReceiptView(
        500L,
        600L,
        "USD",
        Instant.parse("2026-03-27T00:00:00Z"),
        LocalDate.parse("2026-03-27"),
        "approved",
        null,
        new BigDecimal("10.00"),
        null,
        9L,
        9L,
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-27T00:00:00Z"),
        null,
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
    when(procurementRepository.findGoodsReceipt(500L)).thenReturn(java.util.Optional.of(receipt));
    when(procurementRepository.findPurchaseOrder(600L)).thenReturn(java.util.Optional.of(po));
    when(authorizationPolicyService.canWriteProcurement(any(), eq(700L))).thenReturn(false);

    GoodsReceiptService service = new GoodsReceiptService(
        procurementRepository,
        idGenerator,
        authorizationPolicyService,
        eventPublisher,
        clock
    );

    ServiceException exception = assertThrows(ServiceException.class, () -> service.postGoodsReceipt(500L));

    assertEquals(403, exception.getStatusCode());
    verify(procurementRepository).findGoodsReceipt(500L);
    verify(procurementRepository).findPurchaseOrder(600L);
    verify(procurementRepository, never()).postGoodsReceipt(500L);
    verifyNoInteractions(eventPublisher);
  }

  @Test
  void listGoodsReceiptsRejectsRequestedOutletOutsideScope() {
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
    when(authorizationPolicyService.resolveProcurementReadableOutletIds(any())).thenReturn(Set.of(700L));
    GoodsReceiptService service = new GoodsReceiptService(
        procurementRepository,
        idGenerator,
        authorizationPolicyService,
        eventPublisher,
        clock
    );

    ServiceException exception = assertThrows(ServiceException.class, () -> service.listGoodsReceipts(
        701L,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        10,
        0
    ));

    assertEquals(403, exception.getStatusCode());
  }

  @Test
  void listGoodsReceiptsDelegatesScopedFilterAndLimit() {
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
    when(authorizationPolicyService.resolveProcurementReadableOutletIds(any())).thenReturn(Set.of(700L));
    when(procurementRepository.listGoodsReceipts(
        Set.of(700L),
        600L,
        "posted",
        LocalDate.parse("2026-03-01"),
        LocalDate.parse("2026-03-31"),
        null,
        null,
        null,
        100,
        0
    )).thenReturn(PagedResult.of(List.of(), 100, 0, 0));

    GoodsReceiptService service = new GoodsReceiptService(
        procurementRepository,
        idGenerator,
        authorizationPolicyService,
        eventPublisher,
        clock
    );
    service.listGoodsReceipts(
        700L,
        600L,
        "posted",
        LocalDate.parse("2026-03-01"),
        LocalDate.parse("2026-03-31"),
        null,
        null,
        null,
        999,
        null
    );

    verify(procurementRepository).listGoodsReceipts(
        Set.of(700L),
        600L,
        "posted",
        LocalDate.parse("2026-03-01"),
        LocalDate.parse("2026-03-31"),
        null,
        null,
        null,
        100,
        0
    );
  }
}
