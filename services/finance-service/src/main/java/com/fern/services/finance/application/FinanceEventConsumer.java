package com.fern.services.finance.application;

import com.dorabets.idempotency.IdempotencyGuard;
import com.dorabets.idempotency.model.IdempotencyResult;
import com.dorabets.idempotency.model.TtlPolicy;
import com.dorabets.common.spring.events.TypedKafkaEventPublisher;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fern.events.core.EventEnvelope;
import com.fern.events.finance.ExpenseRecordCreatedEvent;
import com.fern.events.payroll.PayrollApprovedEvent;
import com.fern.events.procurement.InvoiceApprovedEvent;
import com.fern.services.finance.infrastructure.FinanceRepository;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import java.time.Clock;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;

@Service
public class FinanceEventConsumer {

  private static final Logger log = LoggerFactory.getLogger(FinanceEventConsumer.class);

  private final FinanceRepository financeRepository;
  private final IdempotencyGuard idempotencyGuard;
  private final SnowflakeIdGenerator idGenerator;
  private final TypedKafkaEventPublisher eventPublisher;
  private final ObjectMapper objectMapper;
  private final Clock clock;

  public FinanceEventConsumer(
      FinanceRepository financeRepository,
      IdempotencyGuard idempotencyGuard,
      SnowflakeIdGenerator idGenerator,
      TypedKafkaEventPublisher eventPublisher,
      ObjectMapper objectMapper,
      Clock clock
  ) {
    this.financeRepository = financeRepository;
    this.idempotencyGuard = idempotencyGuard;
    this.idGenerator = idGenerator;
    this.eventPublisher = eventPublisher;
    this.objectMapper = objectMapper;
    this.clock = clock;
  }

  @KafkaListener(topics = "fern.procurement.invoice-approved")
  public void consumeInvoiceApprovedEvent(String message) {
    handleInvoiceApproved(message);
  }

  @KafkaListener(topics = "fern.payroll.payroll-approved")
  public void consumePayrollApprovedEvent(String message) {
    handlePayrollApproved(message);
  }

  void handleInvoiceApproved(String rawMessage) {
    try {
      EventEnvelope<InvoiceApprovedEvent> envelope = objectMapper.readValue(
          rawMessage,
          new TypeReference<EventEnvelope<InvoiceApprovedEvent>>() { }
      );
      InvoiceApprovedEvent event = envelope.payload();
      if (event == null) {
        log.warn("Skipping empty procurement invoice-approved payload");
        return;
      }
      idempotencyGuard.execute(
          "finance-service",
          envelope.eventId(),
          rawMessage,
          TtlPolicy.SETTLEMENT,
          () -> {
            for (Long receiptId : event.linkedReceiptIds()) {
              FinanceRepository.GoodsReceiptExpenseCandidate candidate = financeRepository
                  .findGoodsReceiptExpenseCandidate(receiptId)
                  .orElseThrow(() -> new IllegalStateException("Goods receipt not found: " + receiptId));
              FinanceRepository.ExpenseRecord record = financeRepository.createInventoryPurchaseExpense(
                  idGenerator.generateId(),
                  candidate,
                  null,
                  "Auto-created from supplier invoice " + event.supplierInvoiceId()
              );
              publishExpenseCreated(record, receiptId);
            }
            return IdempotencyResult.created(
                toJson(Map.of("supplierInvoiceId", event.supplierInvoiceId(), "receiptsProcessed", event.linkedReceiptIds().size())),
                Long.toString(event.supplierInvoiceId())
            );
          }
      );
    } catch (Exception e) {
      throw new IllegalStateException("Failed to process invoice-approved event", e);
    }
  }

  void handlePayrollApproved(String rawMessage) {
    try {
      EventEnvelope<PayrollApprovedEvent> envelope = objectMapper.readValue(
          rawMessage,
          new TypeReference<EventEnvelope<PayrollApprovedEvent>>() { }
      );
      PayrollApprovedEvent event = envelope.payload();
      if (event == null) {
        log.warn("Skipping empty payroll-approved payload");
        return;
      }
      idempotencyGuard.execute(
          "finance-service",
          envelope.eventId(),
          rawMessage,
          TtlPolicy.SETTLEMENT,
          () -> {
            FinanceRepository.PayrollExpenseCandidate candidate = financeRepository.findPayrollExpenseCandidate(event.payrollId())
                .orElseThrow(() -> new IllegalStateException("Payroll not found: " + event.payrollId()));
            FinanceRepository.ExpenseRecord record = financeRepository.createPayrollExpense(
                idGenerator.generateId(),
                candidate,
                null,
                "Auto-created from approved payroll " + event.payrollId()
            );
            publishExpenseCreated(record, event.payrollId());
            return IdempotencyResult.created(
                toJson(Map.of("payrollId", event.payrollId(), "expenseId", record.id())),
                Long.toString(record.id())
            );
          }
      );
    } catch (Exception e) {
      throw new IllegalStateException("Failed to process payroll-approved event", e);
    }
  }

  private void publishExpenseCreated(FinanceRepository.ExpenseRecord record, long sourceId) {
    eventPublisher.publish(
        "fern.finance.expense-record-created",
        Long.toString(record.id()),
        "finance.expense-record-created",
        new ExpenseRecordCreatedEvent(
            record.id(),
            sourceId,
            record.amount(),
            record.currencyCode(),
            clock.instant()
        )
    );
  }

  private String toJson(Object value) {
    try {
      return objectMapper.writeValueAsString(value);
    } catch (Exception e) {
      throw new IllegalStateException("Unable to serialize idempotency response", e);
    }
  }
}
