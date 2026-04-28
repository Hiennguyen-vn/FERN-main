package com.fern.services.sales.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fern.common.middleware.ServiceException;
import com.fern.services.sales.api.PublicPosDtos;
import com.fern.services.sales.api.SalesDtos;
import com.fern.services.sales.infrastructure.SalesRepository;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class PublicPosServiceTest {

  @Mock
  private SalesRepository salesRepository;

  private final Clock clock = Clock.fixed(Instant.parse("2026-03-31T08:30:00Z"), ZoneOffset.UTC);

  @Test
  void getTableReturnsBusinessDateInTableTimezone() {
    when(salesRepository.findPublicOrderingTable("tbl_hcm1_u7k29q"))
        .thenReturn(Optional.of(activeTable()));

    PublicPosService service = new PublicPosService(salesRepository, clock, mock(PromotionEngine.class), false);
    PublicPosDtos.PublicTableView table = service.getTable("tbl_hcm1_u7k29q");

    assertEquals("VN-HCM-001", table.outletCode());
    assertEquals(LocalDate.parse("2026-03-31"), table.businessDate());
  }

  @Test
  void listMenuRejectsUnavailableTables() {
    when(salesRepository.findPublicOrderingTable("tbl_hcm1_unavailable_9x2m"))
        .thenReturn(Optional.of(new SalesRepository.PublicOrderingTableRecord(
            9601L,
            2000L,
            "T9",
            "Table 9",
            "tbl_hcm1_unavailable_9x2m",
            "unavailable",
            "VN-HCM-001",
            "Ho Chi Minh Cafe 1",
            "active",
            "VND",
            "Asia/Ho_Chi_Minh"
        )));

    PublicPosService service = new PublicPosService(salesRepository, clock, mock(PromotionEngine.class), false);

    ServiceException exception =
        assertThrows(
            ServiceException.class,
            () -> service.listMenu("tbl_hcm1_unavailable_9x2m", null));
    assertEquals(409, exception.getStatusCode());
  }

  @Test
  void createOrderBuildsReceiptFromSaleAndMenu() {
    when(salesRepository.findPublicOrderingTable("tbl_hcm1_u7k29q"))
        .thenReturn(Optional.of(activeTable()));
    when(salesRepository.listPublicMenu(2000L, LocalDate.parse("2026-03-31")))
        .thenReturn(
            List.of(
                new PublicPosDtos.PublicMenuItemView(
                    "501",
                    "CAPPUCCINO",
                    "Cappuccino",
                    "coffee",
                    null,
                    null,
                    new BigDecimal("35000.00"),
                    "VND")));
    when(
            salesRepository.submitPublicOrder(
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.eq(LocalDate.parse("2026-03-31"))))
        .thenReturn(
            new SalesRepository.CreatedPublicOrder(
                "ord_public_9800",
                new SalesDtos.SaleView(
                    "9800",
                    2000L,
                    null,
                    "ord_public_9800",
                    "T1",
                    "Table 1",
                    "VND",
                    "online",
                    "order_created",
                    "unpaid",
                    new BigDecimal("35000.00"),
                    BigDecimal.ZERO,
                    BigDecimal.ZERO,
                    new BigDecimal("35000.00"),
                    "QR order T1 (Table 1)",
                    List.of(
                        new SalesDtos.SaleLineView(
                            501L,
                            "PROD-501",
                            "Public Product",
                            BigDecimal.ONE,
                            new BigDecimal("35000.00"),
                            BigDecimal.ZERO,
                            BigDecimal.ZERO,
                            new BigDecimal("35000.00"),
                            java.util.Set.of(),
                            null,
                            null, null, null)),
                    null,
                    Instant.parse("2026-03-31T08:35:00Z"))));

    PublicPosService service = new PublicPosService(salesRepository, clock, mock(PromotionEngine.class), false);
    PublicPosDtos.PublicOrderReceiptView receipt =
        service.createOrder(
            "tbl_hcm1_u7k29q",
            new PublicPosDtos.CreatePublicOrderRequest(
                List.of(new PublicPosDtos.PublicOrderLineRequest("501", BigDecimal.ONE, null)),
                "No sugar"));

    assertEquals("ord_public_9800", receipt.orderToken());
    assertEquals("order_created", receipt.orderStatus());
    assertEquals("Cappuccino", receipt.items().get(0).productName());
    verify(salesRepository).submitPublicOrder(
        org.mockito.ArgumentMatchers.any(),
        org.mockito.ArgumentMatchers.any(),
        org.mockito.ArgumentMatchers.eq(LocalDate.parse("2026-03-31")));
  }

  @Test
  void createOrderWithPromotionEnginePassesDiscountsAndPromotionIdToRepository() {
    PromotionEngine promotionEngine = mock(PromotionEngine.class);
    when(salesRepository.findPublicOrderingTable("tbl_hcm1_u7k29q"))
        .thenReturn(Optional.of(activeTable()));
    when(salesRepository.listPublicMenu(2000L, LocalDate.parse("2026-03-31")))
        .thenReturn(List.of(
            new PublicPosDtos.PublicMenuItemView(
                "501",
                "CAPPUCCINO",
                "Cappuccino",
                "coffee",
                null,
                null,
                new BigDecimal("35000.00"),
                "VND")));
    when(promotionEngine.evaluateForCart(eq(2000L), any()))
        .thenReturn(new PromotionEngine.Allocation(
            44L,
            new BigDecimal("5000.00"),
            List.of(new PromotionEngine.LineDiscount(501L, new BigDecimal("5000.00")))));
    when(salesRepository.submitPublicOrder(
        any(),
        any(),
        eq(LocalDate.parse("2026-03-31")),
        eq(Map.of(501L, new BigDecimal("5000.00"))),
        eq(44L)))
        .thenReturn(new SalesRepository.CreatedPublicOrder(
            "ord_public_9801",
            new SalesDtos.SaleView(
                "9801",
                2000L,
                null,
                "ord_public_9801",
                "T1",
                "Table 1",
                "VND",
                "online",
                "order_created",
                "unpaid",
                new BigDecimal("35000.00"),
                new BigDecimal("5000.00"),
                BigDecimal.ZERO,
                new BigDecimal("30000.00"),
                "QR order T1 (Table 1)",
                List.of(new SalesDtos.SaleLineView(
                    501L,
                    "PROD-501",
                    "Public Product",
                    BigDecimal.ONE,
                    new BigDecimal("35000.00"),
                    new BigDecimal("5000.00"),
                    BigDecimal.ZERO,
                    new BigDecimal("30000.00"),
                    java.util.Set.of(44L),
                    null,
                    null, null, null)),
                null,
                Instant.parse("2026-03-31T08:36:00Z"))));

    PublicPosService service = new PublicPosService(salesRepository, clock, promotionEngine, true);
    PublicPosDtos.PublicOrderReceiptView receipt = service.createOrder(
        "tbl_hcm1_u7k29q",
        new PublicPosDtos.CreatePublicOrderRequest(
            List.of(new PublicPosDtos.PublicOrderLineRequest("501", BigDecimal.ONE, null)),
            null));

    assertEquals("ord_public_9801", receipt.orderToken());
    verify(salesRepository).submitPublicOrder(
        any(),
        any(),
        eq(LocalDate.parse("2026-03-31")),
        eq(Map.of(501L, new BigDecimal("5000.00"))),
        eq(44L));
  }

  @Test
  void createOrderMapsStockConflictToCustomerSafeMessage() {
    when(salesRepository.findPublicOrderingTable("tbl_hcm1_u7k29q"))
        .thenReturn(Optional.of(activeTable()));
    when(salesRepository.listPublicMenu(2000L, LocalDate.parse("2026-03-31")))
        .thenReturn(List.of(
            new PublicPosDtos.PublicMenuItemView(
                "501",
                "CAPPUCCINO",
                "Cappuccino",
                "coffee",
                null,
                null,
                new BigDecimal("35000.00"),
                "VND")));
    when(
        salesRepository.submitPublicOrder(
            org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.eq(LocalDate.parse("2026-03-31"))))
        .thenThrow(ServiceException.conflict(
            "Insufficient stock for one or more items",
            List.of(java.util.Map.of("itemCode", "BEAN-001"))));

    PublicPosService service = new PublicPosService(salesRepository, clock, mock(PromotionEngine.class), false);

    ServiceException exception = assertThrows(
        ServiceException.class,
        () -> service.createOrder(
            "tbl_hcm1_u7k29q",
            new PublicPosDtos.CreatePublicOrderRequest(
                List.of(new PublicPosDtos.PublicOrderLineRequest("501", BigDecimal.ONE, null)),
                null
            ))
    );

    assertEquals(409, exception.getStatusCode());
    assertEquals(
        "One or more items are unavailable or exceed the stock available for this table",
        exception.getMessage());
  }

  private SalesRepository.PublicOrderingTableRecord activeTable() {
    return new SalesRepository.PublicOrderingTableRecord(
        9600L,
        2000L,
        "T1",
        "Table 1",
        "tbl_hcm1_u7k29q",
        "active",
        "VN-HCM-001",
        "Ho Chi Minh Cafe 1",
        "active",
        "VND",
        "Asia/Ho_Chi_Minh");
  }
}
