package com.fern.services.procurement.api;

import com.dorabets.common.spring.web.PagedResult;
import com.fern.services.procurement.application.SupplierPaymentService;
import jakarta.validation.Valid;
import java.time.Instant;
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
@RequestMapping("/api/v1/procurement/payments")
public class SupplierPaymentController {

  private final SupplierPaymentService supplierPaymentService;

  public SupplierPaymentController(SupplierPaymentService supplierPaymentService) {
    this.supplierPaymentService = supplierPaymentService;
  }

  @PostMapping
  public ResponseEntity<ProcurementDtos.SupplierPaymentView> createPayment(
      @Valid @RequestBody ProcurementDtos.CreateSupplierPaymentRequest request
  ) {
    return ResponseEntity.status(HttpStatus.CREATED).body(supplierPaymentService.createPayment(request));
  }

  @GetMapping("/{paymentId}")
  public ProcurementDtos.SupplierPaymentView getPayment(@PathVariable long paymentId) {
    return supplierPaymentService.getPayment(paymentId);
  }

  @GetMapping
  public PagedResult<ProcurementDtos.SupplierPaymentListItemView> listPayments(
      @RequestParam(required = false) Long outletId,
      @RequestParam(required = false) Long supplierId,
      @RequestParam(required = false) String status,
      @RequestParam(required = false) Instant startTime,
      @RequestParam(required = false) Instant endTime,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(required = false) String sortBy,
      @RequestParam(required = false) String sortDir,
      @RequestParam(required = false) Integer limit,
      @RequestParam(required = false) Integer offset
  ) {
    return supplierPaymentService.listPayments(
        outletId,
        supplierId,
        status,
        startTime,
        endTime,
        q,
        sortBy,
        sortDir,
        limit,
        offset);
  }

  @PostMapping("/{paymentId}/post")
  public ProcurementDtos.SupplierPaymentView postPayment(@PathVariable long paymentId) {
    return supplierPaymentService.postPayment(paymentId);
  }

  @PostMapping("/{paymentId}/cancel")
  public ProcurementDtos.SupplierPaymentView cancelPayment(@PathVariable long paymentId) {
    return supplierPaymentService.cancelPayment(paymentId);
  }

  @PostMapping("/{paymentId}/reverse")
  public ProcurementDtos.SupplierPaymentView reversePayment(@PathVariable long paymentId) {
    return supplierPaymentService.reversePayment(paymentId);
  }
}
