package com.fern.services.inventory.api;

import com.fern.common.middleware.ServiceException;
import com.fern.common.spring.auth.AuthorizationPolicyService;
import com.fern.common.spring.auth.RequestUserContextHolder;
import com.fern.common.spring.web.PagedResult;
import com.fern.services.inventory.application.InventoryService;
import jakarta.validation.Valid;
import java.time.LocalDate;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/inventory")
public class InventoryController {

  private final InventoryService inventoryService;
  private final com.fern.services.inventory.application.StockReservationService reservationService;
  private final AuthorizationPolicyService authorizationPolicyService;

  public InventoryController(
      InventoryService inventoryService,
      com.fern.services.inventory.application.StockReservationService reservationService,
      AuthorizationPolicyService authorizationPolicyService
  ) {
    this.inventoryService = inventoryService;
    this.reservationService = reservationService;
    this.authorizationPolicyService = authorizationPolicyService;
  }

  @PostMapping("/reservations")
  @ResponseStatus(HttpStatus.CREATED)
  public java.util.Map<String, Object> reserveStock(
      @RequestBody java.util.Map<String, Object> body
  ) {
    long locationId = ((Number) body.get("locationId")).longValue();
    var ctx = RequestUserContextHolder.get();
    if (!authorizationPolicyService.canWriteInventory(ctx, locationId)) {
      throw ServiceException.forbidden("Inventory write access denied for location " + locationId);
    }
    Long saleId = body.get("saleId") == null ? null : ((Number) body.get("saleId")).longValue();
    Number ttl = (Number) body.get("ttlSeconds");
    java.time.Duration ttlDuration = ttl == null ? java.time.Duration.ofMinutes(15)
        : java.time.Duration.ofSeconds(ttl.longValue());
    @SuppressWarnings("unchecked")
    java.util.List<java.util.Map<String, Object>> linesIn =
        (java.util.List<java.util.Map<String, Object>>) body.get("lines");
    java.util.List<com.fern.services.inventory.application.StockReservationService.ReserveLine> lines =
        new java.util.ArrayList<>();
    if (linesIn != null) {
      for (java.util.Map<String, Object> l : linesIn) {
        long itemId = ((Number) l.get("itemId")).longValue();
        java.math.BigDecimal qty = new java.math.BigDecimal(l.get("qty").toString());
        lines.add(new com.fern.services.inventory.application.StockReservationService.ReserveLine(itemId, qty));
      }
    }
    var reservations = reservationService.reserve(locationId, saleId, lines, ttlDuration);
    return java.util.Map.of("reservations", reservations, "count", reservations.size());
  }

  @GetMapping("/stock-available")
  public java.util.Map<String, Object> stockAvailable(
      @RequestParam long locationId,
      @RequestParam("itemId") java.util.List<Long> itemIds
  ) {
    var ctx = RequestUserContextHolder.get();
    if (!authorizationPolicyService.canWriteInventory(ctx, locationId)) {
      throw ServiceException.forbidden("Inventory read access denied for location " + locationId);
    }
    return java.util.Map.of("locationId", locationId,
        "available", reservationService.available(locationId, itemIds));
  }

  @GetMapping("/stock-balances/{outletId}/{itemId}")
  public InventoryDtos.StockBalanceView getStockBalance(
      @PathVariable long outletId,
      @PathVariable long itemId
  ) {
    return inventoryService.getStockBalance(outletId, itemId);
  }

  @GetMapping("/stock-balances")
  public PagedResult<InventoryDtos.StockBalanceView> listStockBalances(
      @RequestParam long outletId,
      @RequestParam(defaultValue = "false") boolean lowOnly,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(required = false) String sortBy,
      @RequestParam(required = false) String sortDir,
      @RequestParam(required = false) Integer limit,
      @RequestParam(required = false) Integer offset
  ) {
    return inventoryService.listStockBalances(outletId, lowOnly, q, sortBy, sortDir, limit, offset);
  }

  @GetMapping("/transactions")
  public PagedResult<InventoryDtos.InventoryTransactionView> listTransactions(
      @RequestParam long outletId,
      @RequestParam(required = false) Long itemId,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate dateFrom,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate dateTo,
      @RequestParam(required = false) String txnType,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(required = false) String sortBy,
      @RequestParam(required = false) String sortDir,
      @RequestParam(required = false) Integer limit,
      @RequestParam(required = false) Integer offset
  ) {
    return inventoryService.listTransactions(
        outletId,
        itemId,
        dateFrom,
        dateTo,
        txnType,
        q,
        sortBy,
        sortDir,
        limit,
        offset
    );
  }

  @PostMapping("/waste")
  public ResponseEntity<InventoryDtos.WasteView> createWaste(
      @Valid @RequestBody InventoryDtos.CreateWasteRequest request
  ) {
    return ResponseEntity.status(HttpStatus.CREATED).body(inventoryService.createWaste(request));
  }

  @PostMapping("/stock-count-sessions")
  public ResponseEntity<InventoryDtos.StockCountSessionView> createStockCountSession(
      @Valid @RequestBody InventoryDtos.CreateStockCountSessionRequest request
  ) {
    return ResponseEntity.status(HttpStatus.CREATED).body(inventoryService.createStockCountSession(request));
  }

  @GetMapping("/stock-count-sessions")
  public PagedResult<InventoryDtos.StockCountSessionListItemView> listStockCountSessions(
      @RequestParam(required = false) Long outletId,
      @RequestParam(required = false) String status,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate dateFrom,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate dateTo,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(required = false) String sortBy,
      @RequestParam(required = false) String sortDir,
      @RequestParam(required = false) Integer limit,
      @RequestParam(required = false) Integer offset
  ) {
    return inventoryService.listStockCountSessions(
        outletId,
        status,
        dateFrom,
        dateTo,
        q,
        sortBy,
        sortDir,
        limit,
        offset
    );
  }

  @GetMapping("/stock-count-sessions/{sessionId}")
  public InventoryDtos.StockCountSessionView getStockCountSession(@PathVariable long sessionId) {
    return inventoryService.getStockCountSession(sessionId);
  }

  @PostMapping("/stock-count-sessions/{sessionId}/post")
  public InventoryDtos.StockCountSessionView postStockCountSession(@PathVariable long sessionId) {
    return inventoryService.postStockCountSession(sessionId);
  }

  @GetMapping("/stock-lots")
  public java.util.List<InventoryDtos.StockLotView> listStockLots(
      @RequestParam(required = false) Long itemId,
      @RequestParam(required = false) Long locationId,
      @RequestParam(required = false) String status,
      @RequestParam(required = false) Integer limit,
      @RequestParam(required = false) Integer offset) {
    return inventoryService.listStockLots(itemId, locationId, status, limit, offset);
  }

  @PostMapping("/stock-lots")
  @ResponseStatus(HttpStatus.CREATED)
  public InventoryDtos.StockLotView createStockLot(@Valid @RequestBody InventoryDtos.CreateStockLotRequest req) {
    return inventoryService.createStockLot(req);
  }
}
