package com.fern.services.sales.api;

import com.dorabets.common.spring.web.PagedResult;
import com.fern.services.sales.application.SalesService;
import jakarta.validation.Valid;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/sales")
public class SalesController {

  private final SalesService salesService;

  public SalesController(SalesService salesService) {
    this.salesService = salesService;
  }

  @PostMapping("/pos-sessions")
  @ResponseStatus(HttpStatus.CREATED)
  public SalesDtos.PosSessionView openPosSession(
      @Valid @RequestBody SalesDtos.OpenPosSessionRequest request
  ) {
    return salesService.openPosSession(request);
  }

  @PostMapping("/pos-sessions/{sessionId}/close")
  public SalesDtos.PosSessionView closePosSession(
      @PathVariable long sessionId,
      @RequestBody(required = false) SalesDtos.ClosePosSessionRequest request
  ) {
    return salesService.closePosSession(sessionId, request);
  }

  @PostMapping("/pos-sessions/{sessionId}/reconcile")
  public SalesDtos.PosSessionReconciliationView reconcilePosSession(
      @PathVariable long sessionId,
      @Valid @RequestBody(required = false) SalesDtos.ReconcilePosSessionRequest request
  ) {
    return salesService.reconcilePosSession(sessionId, request);
  }

  @PostMapping("/orders")
  @ResponseStatus(HttpStatus.CREATED)
  public SalesDtos.SaleView submitSale(@Valid @RequestBody SalesDtos.SubmitSaleRequest request) {
    return salesService.submitSale(request);
  }

  @GetMapping("/ordering-tables")
  public List<SalesDtos.OrderingTableLinkView> listOrderingTables(
      @RequestParam(required = false) Long outletId,
      @RequestParam(required = false) String status
  ) {
    return salesService.listOrderingTables(outletId, status);
  }

  @GetMapping("/ordering-tables/{tableToken}")
  public SalesDtos.OrderingTableDetailView getOrderingTable(@PathVariable String tableToken) {
    return salesService.getOrderingTable(tableToken);
  }

  @PostMapping("/ordering-tables")
  @ResponseStatus(HttpStatus.CREATED)
  public SalesDtos.OrderingTableDetailView createOrderingTable(
      @Valid @RequestBody SalesDtos.CreateOrderingTableRequest request
  ) {
    return salesService.createOrderingTable(request);
  }

  @PutMapping("/ordering-tables/{tableToken}")
  public SalesDtos.OrderingTableDetailView updateOrderingTable(
      @PathVariable String tableToken,
      @RequestBody(required = false) SalesDtos.UpdateOrderingTableRequest request
  ) {
    return salesService.updateOrderingTable(tableToken, request == null ? new SalesDtos.UpdateOrderingTableRequest(null, null) : request);
  }

  @GetMapping("/orders")
  public PagedResult<SalesDtos.SaleListItemView> listSales(
      @RequestParam(required = false) Long outletId,
      @RequestParam(required = false) LocalDate startDate,
      @RequestParam(required = false) LocalDate endDate,
      @RequestParam(required = false) String status,
      @RequestParam(required = false) String paymentStatus,
      @RequestParam(required = false) Boolean publicOrderOnly,
      @RequestParam(required = false) Long posSessionId,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(required = false) String sortBy,
      @RequestParam(required = false) String sortDir,
      @RequestParam(required = false) Integer limit,
      @RequestParam(required = false) Integer offset
  ) {
    return salesService.listSales(
        outletId,
        startDate,
        endDate,
        status,
        paymentStatus,
        publicOrderOnly,
        posSessionId,
        q,
        sortBy,
        sortDir,
        limit,
        offset);
  }

  @GetMapping("/orders/{saleId}")
  public SalesDtos.SaleView getSale(@PathVariable long saleId) {
    return salesService.getSale(saleId);
  }

  @PostMapping("/orders/{saleId}/approve")
  public SalesDtos.SaleView approveSale(@PathVariable long saleId) {
    return salesService.approveSale(saleId);
  }

  @PostMapping("/orders/{saleId}/confirm")
  public SalesDtos.SaleView confirmSale(@PathVariable long saleId) {
    return salesService.confirmSale(saleId);
  }

  @PostMapping("/orders/{saleId}/mark-payment-done")
  public SalesDtos.SaleView markPaymentDone(
      @PathVariable long saleId,
      @Valid @RequestBody SalesDtos.MarkPaymentDoneRequest request
  ) {
    return salesService.markPaymentDone(saleId, request);
  }

  @PostMapping("/orders/{saleId}/cancel")
  public SalesDtos.SaleView cancelSale(
      @PathVariable long saleId,
      @RequestBody(required = false) SalesDtos.CancelSaleRequest request
  ) {
    return salesService.cancelSale(saleId, request);
  }

  @GetMapping("/pos-sessions")
  public PagedResult<SalesDtos.PosSessionListItemView> listPosSessions(
      @RequestParam(required = false) Long outletId,
      @RequestParam(required = false) LocalDate businessDate,
      @RequestParam(required = false) LocalDate startDate,
      @RequestParam(required = false) LocalDate endDate,
      @RequestParam(required = false) String status,
      @RequestParam(required = false) Long managerId,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(required = false) String sortBy,
      @RequestParam(required = false) String sortDir,
      @RequestParam(required = false) Integer limit,
      @RequestParam(required = false) Integer offset
  ) {
    return salesService.listPosSessions(
        outletId,
        businessDate,
        startDate,
        endDate,
        status,
        managerId,
        q,
        sortBy,
        sortDir,
        limit,
        offset);
  }

  @GetMapping("/pos-sessions/{sessionId}")
  public SalesDtos.PosSessionView getPosSession(@PathVariable long sessionId) {
    return salesService.getPosSession(sessionId);
  }

  @GetMapping("/outlet-stats")
  public SalesDtos.OutletStatsView getOutletStats(
      @RequestParam long outletId,
      @RequestParam(required = false) LocalDate onDate
  ) {
    return salesService.getOutletStats(outletId, onDate);
  }

  @GetMapping("/promotions")
  public PagedResult<SalesDtos.PromotionView> listPromotions(
      @RequestParam(required = false) Long outletId,
      @RequestParam(required = false) String status,
      @RequestParam(required = false) Instant effectiveAt,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(required = false) String sortBy,
      @RequestParam(required = false) String sortDir,
      @RequestParam(required = false) Integer limit,
      @RequestParam(required = false) Integer offset
  ) {
    return salesService.listPromotions(outletId, status, effectiveAt, q, sortBy, sortDir, limit, offset);
  }

  @GetMapping("/promotions/{promotionId}")
  public SalesDtos.PromotionView getPromotion(@PathVariable long promotionId) {
    return salesService.getPromotion(promotionId);
  }

  @PostMapping("/promotions")
  @ResponseStatus(HttpStatus.CREATED)
  public SalesDtos.PromotionView createPromotion(
      @Valid @RequestBody SalesDtos.CreatePromotionRequest request
  ) {
    return salesService.createPromotion(request);
  }

  @PostMapping("/promotions/{promotionId}/deactivate")
  public SalesDtos.PromotionView deactivatePromotion(@PathVariable long promotionId) {
    return salesService.deactivatePromotion(promotionId);
  }
}
