package com.fern.services.procurement.api;

import com.dorabets.common.spring.web.PagedResult;
import com.fern.events.procurement.InvoiceApprovedEvent;
import com.fern.services.procurement.application.SupplierInvoiceService;
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
@RequestMapping("/api/v1/procurement/invoices")
public class SupplierInvoiceController {

  private final SupplierInvoiceService supplierInvoiceService;

  public SupplierInvoiceController(SupplierInvoiceService supplierInvoiceService) {
    this.supplierInvoiceService = supplierInvoiceService;
  }

  @PostMapping
  public ResponseEntity<ProcurementDtos.SupplierInvoiceView> createInvoice(
      @Valid @RequestBody ProcurementDtos.CreateSupplierInvoiceRequest request
  ) {
    return ResponseEntity.status(HttpStatus.CREATED).body(supplierInvoiceService.createInvoice(request));
  }

  @GetMapping("/{invoiceId}")
  public ProcurementDtos.SupplierInvoiceView getInvoice(@PathVariable long invoiceId) {
    return supplierInvoiceService.getInvoice(invoiceId);
  }

  @GetMapping
  public PagedResult<ProcurementDtos.SupplierInvoiceListItemView> listInvoices(
      @RequestParam(required = false) Long outletId,
      @RequestParam(required = false) Long supplierId,
      @RequestParam(required = false) String status,
      @RequestParam(required = false) LocalDate invoiceDateFrom,
      @RequestParam(required = false) LocalDate invoiceDateTo,
      @RequestParam(required = false) LocalDate dueDateTo,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(required = false) String sortBy,
      @RequestParam(required = false) String sortDir,
      @RequestParam(required = false) Integer limit,
      @RequestParam(required = false) Integer offset
  ) {
    return supplierInvoiceService.listInvoices(
        outletId,
        supplierId,
        status,
        invoiceDateFrom,
        invoiceDateTo,
        dueDateTo,
        q,
        sortBy,
        sortDir,
        limit,
        offset
    );
  }

  @PostMapping("/{invoiceId}/approve")
  public InvoiceApprovedEvent approveInvoice(@PathVariable long invoiceId) {
    return supplierInvoiceService.approveInvoice(invoiceId);
  }
}
