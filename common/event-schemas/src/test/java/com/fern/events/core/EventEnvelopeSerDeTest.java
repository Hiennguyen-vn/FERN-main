package com.fern.events.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fern.events.finance.ExpenseRecordCreatedEvent;
import com.fern.events.payroll.PayrollApprovedEvent;
import com.fern.events.procurement.GoodsReceiptPostedEvent;
import com.fern.events.procurement.GoodsReceiptPostedLineItem;
import com.fern.events.procurement.InvoiceApprovedEvent;
import com.fern.events.sales.SaleApprovedEvent;
import com.fern.events.sales.SaleCompletedLineItem;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

class EventEnvelopeSerDeTest {

  private final ObjectMapper mapper = new ObjectMapper().findAndRegisterModules();

  @Test
  void roundTripGoodsReceiptPosted() throws Exception {
    GoodsReceiptPostedEvent payload = new GoodsReceiptPostedEvent(
        500L, 600L, 700L, 800L,
        LocalDate.parse("2026-03-27"),
        "USD",
        List.of(new GoodsReceiptPostedLineItem(
            99L, "kg", new BigDecimal("2.0000"), new BigDecimal("5.00"),
            new BigDecimal("10.00"), null, null)),
        new BigDecimal("10.00"),
        Instant.parse("2026-03-27T00:00:00Z"),
        9L, "alice", List.of("admin"), "corr-1"
    );
    EventEnvelope<GoodsReceiptPostedEvent> envelope = EventEnvelope.create(
        "procurement.goods-receipt-posted", "500", payload, "procurement-service");

    String json = mapper.writeValueAsString(envelope);
    EventEnvelope<GoodsReceiptPostedEvent> roundTrip = mapper.readValue(
        json, new TypeReference<EventEnvelope<GoodsReceiptPostedEvent>>() {});

    assertNotNull(roundTrip.eventId());
    assertEquals("procurement.goods-receipt-posted", roundTrip.eventType());
    assertEquals("500", roundTrip.aggregateId());
    assertEquals(1, roundTrip.version());
    assertEquals(500L, roundTrip.payload().goodsReceiptId());
    assertEquals("USD", roundTrip.payload().currencyCode());
    assertEquals(1, roundTrip.payload().lineItems().size());
  }

  @Test
  void roundTripInvoiceApproved() throws Exception {
    InvoiceApprovedEvent payload = new InvoiceApprovedEvent(
        300L, 400L, 700L,
        LocalDate.parse("2026-03-27"), "USD",
        new BigDecimal("100.00"), List.of(500L),
        Instant.parse("2026-03-27T00:00:00Z"),
        9L, "alice", List.of("admin"), "corr-1"
    );
    EventEnvelope<InvoiceApprovedEvent> envelope = EventEnvelope.create(
        "procurement.invoice-approved", "300", payload, "procurement-service");

    String json = mapper.writeValueAsString(envelope);
    EventEnvelope<InvoiceApprovedEvent> roundTrip = mapper.readValue(
        json, new TypeReference<EventEnvelope<InvoiceApprovedEvent>>() {});

    assertEquals(300L, roundTrip.payload().supplierInvoiceId());
    assertEquals(List.of(500L), roundTrip.payload().linkedReceiptIds());
  }

  @Test
  void roundTripPayrollApproved() throws Exception {
    PayrollApprovedEvent payload = new PayrollApprovedEvent(
        99L, 11L, 12L, 13L, "USD",
        new BigDecimal("450.00"),
        Instant.parse("2026-03-27T00:00:00Z")
    );
    EventEnvelope<PayrollApprovedEvent> envelope = EventEnvelope.create(
        "payroll.payroll-approved", "99", payload, "payroll-service");

    String json = mapper.writeValueAsString(envelope);
    EventEnvelope<PayrollApprovedEvent> roundTrip = mapper.readValue(
        json, new TypeReference<EventEnvelope<PayrollApprovedEvent>>() {});

    assertEquals(99L, roundTrip.payload().payrollId());
    assertEquals(new BigDecimal("450.00"), roundTrip.payload().netSalary());
  }

  @Test
  void roundTripExpenseRecordCreated() throws Exception {
    ExpenseRecordCreatedEvent payload = new ExpenseRecordCreatedEvent(
        501L, 501L, new BigDecimal("12.50"), "USD",
        Instant.parse("2026-03-27T00:00:00Z"),
        501L, 7L, 9L, "alice", List.of("admin"), "corr-1", null
    );
    EventEnvelope<ExpenseRecordCreatedEvent> envelope = EventEnvelope.create(
        "finance.expense-record-created", "501", payload, "finance-service");

    String json = mapper.writeValueAsString(envelope);
    EventEnvelope<ExpenseRecordCreatedEvent> roundTrip = mapper.readValue(
        json, new TypeReference<EventEnvelope<ExpenseRecordCreatedEvent>>() {});

    assertEquals(501L, roundTrip.payload().expenseId());
    assertEquals("USD", roundTrip.payload().currencyCode());
  }

  @Test
  void roundTripSaleApproved() throws Exception {
    SaleApprovedEvent payload = new SaleApprovedEvent(
        44L, 7L, LocalDate.parse("2026-04-27"),
        Instant.parse("2026-04-27T09:55:00Z"),
        42L, false, true,
        List.of(new SaleCompletedLineItem(
            501L, new BigDecimal("2.0000"), new BigDecimal("10.00"),
            BigDecimal.ZERO, BigDecimal.ZERO, new BigDecimal("20.00"))),
        null
    );
    EventEnvelope<SaleApprovedEvent> envelope = EventEnvelope.create(
        "sales.sale-approved", "44", payload, "sales-service");

    String json = mapper.writeValueAsString(envelope);
    EventEnvelope<SaleApprovedEvent> roundTrip = mapper.readValue(
        json, new TypeReference<EventEnvelope<SaleApprovedEvent>>() {});

    assertEquals(44L, roundTrip.payload().saleId());
    assertEquals(1, roundTrip.payload().lineItems().size());
  }

  @Test
  void envelopeUsesCamelCaseFields() throws Exception {
    PayrollApprovedEvent payload = new PayrollApprovedEvent(
        99L, 11L, 12L, 13L, "USD",
        new BigDecimal("100.00"), Instant.parse("2026-03-27T00:00:00Z"));
    EventEnvelope<PayrollApprovedEvent> envelope = EventEnvelope.create(
        "payroll.payroll-approved", "99", payload, "payroll-service");

    String json = mapper.writeValueAsString(envelope);

    org.junit.jupiter.api.Assertions.assertTrue(json.contains("\"eventId\""));
    org.junit.jupiter.api.Assertions.assertTrue(json.contains("\"aggregateId\""));
    org.junit.jupiter.api.Assertions.assertTrue(json.contains("\"eventType\""));
    org.junit.jupiter.api.Assertions.assertTrue(json.contains("\"sourceComponent\""));
    org.junit.jupiter.api.Assertions.assertTrue(json.contains("\"timestamp\""));
  }
}
