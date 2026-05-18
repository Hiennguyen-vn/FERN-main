package com.fern.services.sales.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fern.common.middleware.ServiceException;
import com.fern.common.spring.auth.RequestUserContext;
import com.fern.common.spring.auth.RequestUserContextHolder;
import com.fern.common.spring.web.PagedResult;
import com.fern.services.sales.application.CrmService;
import com.fern.services.sales.application.DeviceService;
import com.fern.services.sales.application.PublicPosService;
import com.fern.services.sales.application.SalesService;
import com.fern.services.sales.application.SyncService;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.io.ByteArrayOutputStream;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class SalesApiControllerTest {

  @AfterEach
  void clearContext() {
    RequestUserContextHolder.clear();
  }

  @Test
  void salesControllerDelegatesAllEndpointsToService() {
    SalesService service = mock(SalesService.class);
    SalesController controller = new SalesController(service);

    controller.openPosSession(null);
    controller.closePosSession(10L, null);
    controller.reconcilePosSession(10L, null);
    controller.submitSale("idem", 101L, null);
    controller.listOrderingTables(7L, "active");
    controller.getOrderingTable("tbl-1");
    controller.createOrderingTable(null);
    controller.updateOrderingTable("tbl-1", null);
    controller.listSales(7L, LocalDate.parse("2026-04-01"), LocalDate.parse("2026-04-30"),
        "completed", "paid", true, 10L, " coffee ", "createdAt", "desc", 25, 5);
    controller.getSale(50L);
    controller.monthlyRevenue(7L, LocalDate.parse("2026-01-01"), LocalDate.parse("2026-04-30"));
    controller.dailyRevenue(7L, LocalDate.parse("2026-04-01"), LocalDate.parse("2026-04-30"));
    controller.approveSale(50L);
    controller.confirmSale(50L);
    controller.markPaymentDone(50L, null);
    controller.cancelSale(50L, null);
    controller.listPosSessions(7L, LocalDate.parse("2026-04-27"), null, null,
        "open", 2L, " reg ", "openedAt", "asc", 50, 0);
    controller.getPosSession(10L);
    controller.getOutletStats(7L, null);
    controller.listPromotions(7L, "active", Instant.parse("2026-04-27T00:00:00Z"),
        "happy", "effectiveFrom", "desc", 20, 0);
    controller.getPromotion(90L);
    controller.createPromotion(null);
    controller.updatePromotion(90L, null);
    controller.deactivatePromotion(90L);

    verify(service).openPosSession(null);
    verify(service).closePosSession(10L, null);
    verify(service).reconcilePosSession(10L, null);
    verify(service).submitSale("idem", 101L, null);
    verify(service).listOrderingTables(7L, "active");
    verify(service).getOrderingTable("tbl-1");
    verify(service).createOrderingTable(null);
    verify(service).updateOrderingTable(eq("tbl-1"), any(SalesDtos.UpdateOrderingTableRequest.class));
    verify(service).listSales(7L, LocalDate.parse("2026-04-01"), LocalDate.parse("2026-04-30"),
        "completed", "paid", true, 10L, " coffee ", "createdAt", "desc", 25, 5);
    verify(service).getSale(50L);
    verify(service).approveSale(50L);
    verify(service).confirmSale(50L);
    verify(service).markPaymentDone(50L, null);
    verify(service).cancelSale(50L, null);
    verify(service).getPosSession(10L);
    verify(service).getOutletStats(7L, null);
    verify(service).getPromotion(90L);
    verify(service).deactivatePromotion(90L);
  }

  @Test
  void publicPosAndCrmControllersDelegate() {
    PublicPosService publicPosService = mock(PublicPosService.class);
    PublicPosController publicController = new PublicPosController(publicPosService);
    publicController.getTable("tbl-1");
    publicController.listMenu("tbl-1", LocalDate.parse("2026-04-27"));
    publicController.getOrder("tbl-1", "ord-1");
    publicController.createOrder("tbl-1", null);

    verify(publicPosService).getTable("tbl-1");
    verify(publicPosService).listMenu("tbl-1", LocalDate.parse("2026-04-27"));
    verify(publicPosService).getOrder("tbl-1", "ord-1");
    verify(publicPosService).createOrder("tbl-1", null);

    CrmService crmService = mock(CrmService.class);
    CrmController crmController = new CrmController(crmService);
    when(crmService.listCustomers(7L, "legacy", "normalized", "name", "asc", 100, 0))
        .thenReturn(PagedResult.of(List.of(), 100, 0, 0));

    crmController.listCustomers(7L, "legacy", "normalized", "name", "asc", 100, 0);

    verify(crmService).listCustomers(7L, "legacy", "normalized", "name", "asc", 100, 0);
  }

  @Test
  void syncControllerStreamsPullResponsesAndEnforcesDeviceOutlet() throws Exception {
    SyncService syncService = mock(SyncService.class);
    DeviceService deviceService = mock(DeviceService.class);
    SyncController controller = new SyncController(syncService, deviceService, new ObjectMapper().findAndRegisterModules());
    when(syncService.pullCatalog(10L, 0L, 5)).thenReturn(List.of(
        new SyncDtos.CatalogRow(1L, 10L, "Coffee", 1L, "Drinks", true, 35000L, 0L, 123L)));

    var response = controller.pullCatalog(10L, 0L, 5);
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    response.getBody().writeTo(out);

    assertEquals("123", response.getHeaders().getFirst("X-Next-Cursor"));
    verify(syncService).pullCatalog(10L, 0L, 5);
    controller.pullStock(10L);
    controller.pullMenu(10L);
    controller.pullTaxRules(10L);
    controller.manifest();
    verify(syncService).pullStock(10L);
    verify(syncService).pullMenu(10L);
    verify(syncService).pullTaxRules(10L);
    verify(syncService).manifest();

    RequestUserContextHolder.set(new RequestUserContext(
        null, "device", null, Set.of(), Set.of(), Set.of(10L),
        true, false, null, 101L, 10L));
    ServiceException exception = assertThrows(ServiceException.class, () -> controller.pullStock(11L));
    assertEquals(403, exception.getStatusCode());
  }

  @Test
  void telemetryControllerRecordsClientMetrics() {
    TelemetryController controller = new TelemetryController(new SimpleMeterRegistry());
    RequestUserContextHolder.set(new RequestUserContext(
        null, "device", null, Set.of(), Set.of(), Set.of(10L),
        true, false, null, 101L, 10L));
    try {
      var response = controller.ingest(new TelemetryDtos.ClientTelemetry(101L, 3, 42L, 2, 1));
      assertEquals(204, response.getStatusCode().value());
    } finally {
      RequestUserContextHolder.clear();
    }
  }

  @Test
  void telemetryControllerRejectsNonDeviceContext() {
    TelemetryController controller = new TelemetryController(new SimpleMeterRegistry());
    RequestUserContextHolder.clear();
    try {
      ServiceException ex = assertThrows(ServiceException.class,
          () -> controller.ingest(new TelemetryDtos.ClientTelemetry(101L, 3, 42L, 2, 1)));
      assertEquals(403, ex.getStatusCode());
    } finally {
      RequestUserContextHolder.clear();
    }
  }
}
