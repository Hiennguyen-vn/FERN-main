package com.fern.services.sales.api.kitchen;

import com.fern.common.middleware.ServiceException;
import com.fern.common.spring.auth.AuthorizationPolicyService;
import com.fern.common.spring.auth.RequestUserContextHolder;
import com.fern.services.sales.application.kitchen.KitchenTicketService;
import jakarta.validation.Valid;
import java.util.Set;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/sales/kitchen")
public class KitchenController {

  private static final Set<String> ITEM_STATUSES = Set.of("preparing", "ready", "served", "cancelled");
  private static final Set<String> TICKET_STATUSES = Set.of("in_progress", "ready", "served", "cancelled");

  private final KitchenTicketService kitchenTicketService;
  private final AuthorizationPolicyService authorizationPolicyService;

  public KitchenController(
      KitchenTicketService kitchenTicketService,
      AuthorizationPolicyService authorizationPolicyService
  ) {
    this.kitchenTicketService = kitchenTicketService;
    this.authorizationPolicyService = authorizationPolicyService;
  }

  @GetMapping("/tickets")
  public ResponseEntity<KitchenDtos.TicketListResponse> listTickets(@RequestParam("outletId") long outletId) {
    var ctx = RequestUserContextHolder.get();
    if (!authorizationPolicyService.canReadKitchenForOutlet(ctx, outletId)) {
      throw ServiceException.forbidden("Kitchen read denied for outlet " + outletId);
    }
    return ResponseEntity.ok(kitchenTicketService.listOpenTickets(outletId));
  }

  @PatchMapping("/tickets/{ticketId}/items/{itemId}/status")
  public ResponseEntity<KitchenDtos.TicketView> advanceItemStatus(
      @PathVariable long ticketId,
      @PathVariable long itemId,
      @Valid @RequestBody KitchenDtos.AdvanceStatusRequest request
  ) {
    long outletId = kitchenTicketService.findOutletForTicket(ticketId)
        .orElseThrow(() -> ServiceException.notFound("Kitchen ticket not found: " + ticketId));
    var ctx = RequestUserContextHolder.get();
    if (!authorizationPolicyService.canWriteKitchenForOutlet(ctx, outletId)) {
      throw ServiceException.forbidden("Kitchen write denied for outlet " + outletId);
    }
    String status = request.status();
    if (!ITEM_STATUSES.contains(status)) {
      throw ServiceException.badRequest("Unsupported item status: " + status);
    }
    return ResponseEntity.ok(kitchenTicketService.advanceItem(ticketId, itemId, status));
  }

  @PatchMapping("/tickets/{ticketId}/status")
  public ResponseEntity<KitchenDtos.TicketView> setTicketStatus(
      @PathVariable long ticketId,
      @Valid @RequestBody KitchenDtos.AdvanceStatusRequest request
  ) {
    long outletId = kitchenTicketService.findOutletForTicket(ticketId)
        .orElseThrow(() -> ServiceException.notFound("Kitchen ticket not found: " + ticketId));
    var ctx = RequestUserContextHolder.get();
    if (!authorizationPolicyService.canWriteKitchenForOutlet(ctx, outletId)) {
      throw ServiceException.forbidden("Kitchen write denied for outlet " + outletId);
    }
    String status = request.status();
    if (!TICKET_STATUSES.contains(status)) {
      throw ServiceException.badRequest("Unsupported ticket status: " + status);
    }
    return ResponseEntity.ok(kitchenTicketService.setTicketStatus(ticketId, status));
  }
}
