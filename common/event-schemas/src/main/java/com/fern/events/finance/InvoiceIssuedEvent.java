package com.fern.events.finance;

import java.time.Instant;

public record InvoiceIssuedEvent(
    long invoiceId,
    long saleId,
    long outletId,
    String invoiceNumber,
    Instant issuedAt
) {}
