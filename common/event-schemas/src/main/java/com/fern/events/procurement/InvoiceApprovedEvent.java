package com.fern.events.procurement;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

public record InvoiceApprovedEvent(
    long supplierInvoiceId,
    long supplierId,
    Long outletId,
    LocalDate invoiceDate,
    String currencyCode,
    BigDecimal totalAmount,
    List<Long> linkedReceiptIds,
    Instant approvedAt,
    Long actorUserId,
    String actorUsername,
    List<String> actorRoles,
    String correlationId
) {
  public InvoiceApprovedEvent(
      long supplierInvoiceId,
      long supplierId,
      LocalDate invoiceDate,
      String currencyCode,
      BigDecimal totalAmount,
      List<Long> linkedReceiptIds,
      Instant approvedAt
  ) {
    this(
        supplierInvoiceId,
        supplierId,
        null,
        invoiceDate,
        currencyCode,
        totalAmount,
        linkedReceiptIds,
        approvedAt,
        null,
        null,
        List.of(),
        null
    );
  }

  public InvoiceApprovedEvent {
    linkedReceiptIds = linkedReceiptIds == null ? List.of() : List.copyOf(linkedReceiptIds);
    actorRoles = actorRoles == null ? List.of() : List.copyOf(actorRoles);
  }
}
