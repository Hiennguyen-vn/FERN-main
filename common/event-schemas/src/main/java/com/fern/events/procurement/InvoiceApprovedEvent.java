package com.fern.events.procurement;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

public record InvoiceApprovedEvent(
    long supplierInvoiceId,
    long supplierId,
    LocalDate invoiceDate,
    String currencyCode,
    BigDecimal totalAmount,
    List<Long> linkedReceiptIds,
    Instant approvedAt
) {
}
