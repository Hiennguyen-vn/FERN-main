package com.fern.services.procurement.api;

import com.dorabets.common.spring.web.PagedResult;
import com.fern.services.procurement.application.PurchaseOrderService;
import jakarta.validation.Valid;
import java.time.LocalDate;
import java.util.List;
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
@RequestMapping("/api/v1/procurement/purchase-orders")
public class PurchaseOrderController {

  private final PurchaseOrderService purchaseOrderService;

  public PurchaseOrderController(PurchaseOrderService purchaseOrderService) {
    this.purchaseOrderService = purchaseOrderService;
  }

  @PostMapping
  public ResponseEntity<ProcurementDtos.PurchaseOrderView> createPurchaseOrder(
      @Valid @RequestBody ProcurementDtos.CreatePurchaseOrderRequest request
  ) {
    return ResponseEntity.status(HttpStatus.CREATED).body(purchaseOrderService.createPurchaseOrder(request));
  }

  @GetMapping("/{purchaseOrderId}")
  public ProcurementDtos.PurchaseOrderView getPurchaseOrder(@PathVariable long purchaseOrderId) {
    return purchaseOrderService.getPurchaseOrder(purchaseOrderId);
  }

  @GetMapping
  public PagedResult<ProcurementDtos.PurchaseOrderListItemView> listPurchaseOrders(
      @RequestParam(required = false) Long outletId,
      @RequestParam(required = false) Long supplierId,
      @RequestParam(required = false) String status,
      @RequestParam(required = false) LocalDate startDate,
      @RequestParam(required = false) LocalDate endDate,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(required = false) String sortBy,
      @RequestParam(required = false) String sortDir,
      @RequestParam(required = false) Integer limit,
      @RequestParam(required = false) Integer offset
  ) {
    return purchaseOrderService.listPurchaseOrders(
        outletId,
        supplierId,
        status,
        startDate,
        endDate,
        q,
        sortBy,
        sortDir,
        limit,
        offset
    );
  }

  @PostMapping("/{purchaseOrderId}/approve")
  public ProcurementDtos.PurchaseOrderView approvePurchaseOrder(@PathVariable long purchaseOrderId) {
    return purchaseOrderService.approvePurchaseOrder(purchaseOrderId);
  }
}
