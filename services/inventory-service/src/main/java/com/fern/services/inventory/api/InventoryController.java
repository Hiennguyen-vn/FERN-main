package com.fern.services.inventory.api;

import com.dorabets.common.spring.web.PagedResult;
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
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/inventory")
public class InventoryController {

  private final InventoryService inventoryService;

  public InventoryController(InventoryService inventoryService) {
    this.inventoryService = inventoryService;
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
}
