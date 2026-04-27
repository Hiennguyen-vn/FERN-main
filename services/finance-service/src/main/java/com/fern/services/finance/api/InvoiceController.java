package com.fern.services.finance.api;

import com.fern.services.finance.application.InvoiceService;
import java.time.Instant;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/finance/invoices")
public class InvoiceController {

  private final InvoiceService invoiceService;

  public InvoiceController(InvoiceService invoiceService) {
    this.invoiceService = invoiceService;
  }

  @GetMapping("/{invoiceId}")
  public ResponseEntity<FinanceDtos.InvoiceView> getById(@PathVariable long invoiceId) {
    return invoiceService.getInvoiceById(invoiceId)
        .map(ResponseEntity::ok)
        .orElse(ResponseEntity.notFound().build());
  }

  @GetMapping("/sale/{saleId}")
  public ResponseEntity<FinanceDtos.InvoiceView> getBySaleId(@PathVariable long saleId) {
    return invoiceService.getInvoiceBySaleId(saleId)
        .map(ResponseEntity::ok)
        .orElse(ResponseEntity.notFound().build());
  }

  @GetMapping
  public List<FinanceDtos.InvoiceSummary> list(
      @RequestParam long outletId,
      @RequestParam(defaultValue = "2000-01-01T00:00:00Z") Instant from,
      @RequestParam(defaultValue = "2099-12-31T23:59:59Z") Instant to,
      @RequestParam(defaultValue = "50") int limit,
      @RequestParam(defaultValue = "0") int offset
  ) {
    return invoiceService.listInvoices(outletId, from, to, limit, offset);
  }
}
