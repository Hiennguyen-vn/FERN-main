package com.fern.services.sales.api.kitchen;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fern.common.middleware.ServiceException;
import com.fern.common.spring.auth.AuthorizationPolicyService;
import com.fern.common.spring.auth.RequestUserContext;
import com.fern.common.spring.auth.RequestUserContextHolder;
import com.fern.services.sales.api.SalesDtos;
import com.fern.services.sales.application.kitchen.KitchenSyncPublisher;
import com.fern.services.sales.application.kitchen.KitchenTicketService;
import com.fern.services.sales.infrastructure.KitchenTicketRepository;
import com.fern.services.sales.infrastructure.SalesRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class KitchenControllerTest {

  @AfterEach
  void clearContext() {
    RequestUserContextHolder.clear();
  }

  private static RequestUserContext kitchenStaffContext() {
    return new RequestUserContext(
        2L, "kitchen", "sess", Set.of("kitchen_staff"), Set.of(), Set.of(10L),
        true, false, null, null, null);
  }

  private static KitchenDtos.TicketView ticket(long id, long outletId, String status) {
    return new KitchenDtos.TicketView(id, 999L, outletId, null, null, null, "dine_in",
        status, 900, null, false, Instant.parse("2026-05-17T10:00:00Z"),
        null, null, null, List.of());
  }

  @Test
  void listTicketsRequiresKitchenRead() {
    KitchenTicketService service = mock(KitchenTicketService.class);
    AuthorizationPolicyService auth = mock(AuthorizationPolicyService.class);
    KitchenController controller = new KitchenController(service, auth);
    RequestUserContextHolder.set(kitchenStaffContext());

    when(auth.canReadKitchenForOutlet(any(), eq(10L))).thenReturn(true);
    when(service.listOpenTickets(10L)).thenReturn(
        new KitchenDtos.TicketListResponse(10L, List.of(ticket(1L, 10L, "new"))));
    var ok = controller.listTickets(10L);
    assertEquals(1, ok.getBody().tickets().size());

    when(auth.canReadKitchenForOutlet(any(), eq(10L))).thenReturn(false);
    ServiceException denied = assertThrows(ServiceException.class, () -> controller.listTickets(10L));
    assertEquals(403, denied.getStatusCode());
  }

  @Test
  void advanceItemStatusRequiresKitchenWrite() {
    KitchenTicketService service = mock(KitchenTicketService.class);
    AuthorizationPolicyService auth = mock(AuthorizationPolicyService.class);
    KitchenController controller = new KitchenController(service, auth);
    RequestUserContextHolder.set(kitchenStaffContext());

    when(service.findOutletForTicket(50L)).thenReturn(Optional.of(10L));
    when(auth.canWriteKitchenForOutlet(any(), eq(10L))).thenReturn(true);
    when(service.advanceItem(50L, 70L, "preparing")).thenReturn(ticket(50L, 10L, "in_progress"));
    var resp = controller.advanceItemStatus(50L, 70L, new KitchenDtos.AdvanceStatusRequest("preparing"));
    assertEquals("in_progress", resp.getBody().status());

    when(auth.canWriteKitchenForOutlet(any(), eq(10L))).thenReturn(false);
    ServiceException denied = assertThrows(ServiceException.class,
        () -> controller.advanceItemStatus(50L, 70L, new KitchenDtos.AdvanceStatusRequest("preparing")));
    assertEquals(403, denied.getStatusCode());
  }

  @Test
  void advanceItemStatusRejectsUnsupportedStatus() {
    KitchenTicketService service = mock(KitchenTicketService.class);
    AuthorizationPolicyService auth = mock(AuthorizationPolicyService.class);
    KitchenController controller = new KitchenController(service, auth);
    RequestUserContextHolder.set(kitchenStaffContext());

    when(service.findOutletForTicket(50L)).thenReturn(Optional.of(10L));
    when(auth.canWriteKitchenForOutlet(any(), eq(10L))).thenReturn(true);
    ServiceException bad = assertThrows(ServiceException.class, () ->
        controller.advanceItemStatus(50L, 70L, new KitchenDtos.AdvanceStatusRequest("invalid")));
    assertEquals(400, bad.getStatusCode());
  }

  @Test
  void advanceItemStatusOnUnknownTicket404() {
    KitchenTicketService service = mock(KitchenTicketService.class);
    AuthorizationPolicyService auth = mock(AuthorizationPolicyService.class);
    KitchenController controller = new KitchenController(service, auth);
    RequestUserContextHolder.set(kitchenStaffContext());

    when(service.findOutletForTicket(50L)).thenReturn(Optional.empty());
    ServiceException nf = assertThrows(ServiceException.class, () ->
        controller.advanceItemStatus(50L, 70L, new KitchenDtos.AdvanceStatusRequest("preparing")));
    assertEquals(404, nf.getStatusCode());
  }

  @Test
  void setTicketStatusRequiresKitchenWriteAndValidStatus() {
    KitchenTicketService service = mock(KitchenTicketService.class);
    AuthorizationPolicyService auth = mock(AuthorizationPolicyService.class);
    KitchenController controller = new KitchenController(service, auth);
    RequestUserContextHolder.set(kitchenStaffContext());

    when(service.findOutletForTicket(60L)).thenReturn(Optional.of(10L));
    when(auth.canWriteKitchenForOutlet(any(), eq(10L))).thenReturn(true);
    when(service.setTicketStatus(60L, "cancelled")).thenReturn(ticket(60L, 10L, "cancelled"));
    var resp = controller.setTicketStatus(60L, new KitchenDtos.AdvanceStatusRequest("cancelled"));
    assertEquals("cancelled", resp.getBody().status());

    ServiceException bad = assertThrows(ServiceException.class, () ->
        controller.setTicketStatus(60L, new KitchenDtos.AdvanceStatusRequest("preparing")));
    assertEquals(400, bad.getStatusCode());
  }

  @Test
  void retailSalesDoNotCreateKitchenTickets() {
    KitchenTicketRepository ticketRepository = mock(KitchenTicketRepository.class);
    SalesRepository salesRepository = mock(SalesRepository.class);
    KitchenSyncPublisher syncPublisher = mock(KitchenSyncPublisher.class);
    KitchenTicketService service = new KitchenTicketService(
        mock(DataSource.class), ticketRepository, salesRepository, syncPublisher);

    SalesDtos.SaleLineView line = new SalesDtos.SaleLineView(
        50L, "SKU-50", "Bagged Coffee", BigDecimal.ONE, BigDecimal.TEN,
        BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.TEN, Set.of(), null,
        null, null, List.of());
    SalesDtos.SaleView sale = new SalesDtos.SaleView(
        "900", 10L, "700", null, null, null, "VND", "retail",
        "order_approved", "unpaid", BigDecimal.TEN, BigDecimal.ZERO, BigDecimal.ZERO,
        BigDecimal.TEN, null, List.of(line), null, Instant.parse("2026-05-17T10:00:00Z"));
    when(salesRepository.findSale(900L)).thenReturn(Optional.of(sale));

    assertEquals(Optional.empty(), service.createFromSale(900L));
    verify(ticketRepository, never()).createTicket(any());
  }

  @Test
  void listOpenTicketsReturnsEarliestDeadlineFirst() {
    KitchenTicketRepository ticketRepository = mock(KitchenTicketRepository.class);
    SalesRepository salesRepository = mock(SalesRepository.class);
    KitchenSyncPublisher syncPublisher = mock(KitchenSyncPublisher.class);
    KitchenTicketService service = new KitchenTicketService(
        mock(DataSource.class), ticketRepository, salesRepository, syncPublisher);

    // Ticket 1 arrives first with a long SLA; ticket 2 arrives later with a short SLA.
    KitchenDtos.TicketView longSla = new KitchenDtos.TicketView(1L, 901L, 10L, null, null, null,
        "dine_in", "new", 600, null, false, Instant.parse("2026-05-17T10:00:00Z"),
        null, null, null, List.of());
    KitchenDtos.TicketView shortSla = new KitchenDtos.TicketView(2L, 902L, 10L, null, null, null,
        "dine_in", "new", 120, null, false, Instant.parse("2026-05-17T10:01:00Z"),
        null, null, null, List.of());
    when(ticketRepository.listOpenTickets(10L)).thenReturn(List.of(longSla, shortSla));

    var tickets = service.listOpenTickets(10L).tickets();
    assertEquals(2L, tickets.get(0).id());
    assertEquals(1L, tickets.get(1).id());
  }

  @Test
  void cancelBySaleBroadcastsWhenTicketCancelled() {
    KitchenTicketRepository ticketRepository = mock(KitchenTicketRepository.class);
    SalesRepository salesRepository = mock(SalesRepository.class);
    KitchenSyncPublisher syncPublisher = mock(KitchenSyncPublisher.class);
    KitchenTicketService service = new KitchenTicketService(
        mock(DataSource.class), ticketRepository, salesRepository, syncPublisher);

    when(ticketRepository.cancelTicketBySale(900L)).thenReturn(Optional.of(55L));
    when(ticketRepository.findTicket(55L)).thenReturn(Optional.of(ticket(55L, 10L, "cancelled")));

    var result = service.cancelBySale(900L);
    assertEquals("cancelled", result.orElseThrow().status());
    verify(syncPublisher).publishTicketUpdated(any());
  }

  @Test
  void cancelBySaleNoOpsWhenNoActiveTicket() {
    KitchenTicketRepository ticketRepository = mock(KitchenTicketRepository.class);
    SalesRepository salesRepository = mock(SalesRepository.class);
    KitchenSyncPublisher syncPublisher = mock(KitchenSyncPublisher.class);
    KitchenTicketService service = new KitchenTicketService(
        mock(DataSource.class), ticketRepository, salesRepository, syncPublisher);

    when(ticketRepository.cancelTicketBySale(900L)).thenReturn(Optional.empty());

    assertEquals(Optional.empty(), service.cancelBySale(900L));
    verify(ticketRepository, never()).findTicket(anyLong());
    verify(syncPublisher, never()).publishTicketUpdated(any());
  }
}
