package com.fern.services.finance.application;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.dorabets.idempotency.IdempotencyGuard;
import com.dorabets.idempotency.model.IdempotencyResult;
import com.dorabets.common.spring.events.TypedKafkaEventPublisher;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fern.events.core.EventEnvelope;
import com.fern.events.payroll.PayrollApprovedEvent;
import com.fern.events.procurement.InvoiceApprovedEvent;
import com.fern.services.finance.infrastructure.FinanceRepository;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class FinanceEventConsumerTest {

  @Mock
  private FinanceRepository financeRepository;
  @Mock
  private IdempotencyGuard idempotencyGuard;
  @Mock
  private SnowflakeIdGenerator idGenerator;
  @Mock
  private TypedKafkaEventPublisher eventPublisher;

  private final ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();
  private final Clock clock = Clock.fixed(Instant.parse("2026-03-27T00:00:00Z"), ZoneOffset.UTC);

  @Test
  void handlePayrollApprovedCreatesExpenseAndPublishesEvent() throws Exception {
    FinanceEventConsumer consumer = new FinanceEventConsumer(
        financeRepository,
        idempotencyGuard,
        idGenerator,
        eventPublisher,
        objectMapper,
        clock
    );

    PayrollApprovedEvent payload = new PayrollApprovedEvent(
        77L,
        15L,
        18L,
        9L,
        "USD",
        new BigDecimal("450.00"),
        Instant.parse("2026-03-27T00:00:00Z")
    );
    String rawMessage = objectMapper.writeValueAsString(
        EventEnvelope.create("payroll.payroll-approved", "77", payload, "payroll-service")
    );

    FinanceRepository.PayrollExpenseCandidate candidate = new FinanceRepository.PayrollExpenseCandidate(
        77L,
        9L,
        java.time.LocalDate.parse("2026-03-27"),
        "USD",
        new BigDecimal("450.00")
    );
    FinanceRepository.ExpenseRecord createdExpense = new FinanceRepository.ExpenseRecord(
        501L,
        9L,
        java.time.LocalDate.parse("2026-03-27"),
        "USD",
        new BigDecimal("450.00"),
        "payroll",
        "Auto-created from approved payroll 77",
        null,
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-27T00:00:00Z"),
        "payroll",
        null
    );

    when(idGenerator.generateId()).thenReturn(501L);
    when(financeRepository.findPayrollExpenseCandidate(77L)).thenReturn(java.util.Optional.of(candidate));
    when(financeRepository.createPayrollExpense(501L, candidate, null, "Auto-created from approved payroll 77"))
        .thenReturn(createdExpense);
    when(idempotencyGuard.execute(eq("finance-service"), any(), eq(rawMessage), any(), any()))
        .thenAnswer(invocation -> ((Supplier<IdempotencyResult>) invocation.getArgument(4)).get());

    consumer.handlePayrollApproved(rawMessage);

    verify(financeRepository).createPayrollExpense(501L, candidate, null, "Auto-created from approved payroll 77");
    verify(eventPublisher).publish(
        eq("fern.finance.expense-record-created"),
        eq("501"),
        eq("finance.expense-record-created"),
        any()
    );
  }

  @Test
  void handleInvoiceApprovedCreatesInventoryExpenseAndPublishesEvent() throws Exception {
    FinanceEventConsumer consumer = new FinanceEventConsumer(
        financeRepository,
        idempotencyGuard,
        idGenerator,
        eventPublisher,
        objectMapper,
        clock
    );

    InvoiceApprovedEvent payload = new InvoiceApprovedEvent(
        301L,
        77L,
        java.time.LocalDate.parse("2026-03-27"),
        "USD",
        new BigDecimal("100.00"),
        java.util.List.of(501L),
        Instant.parse("2026-03-27T00:00:00Z")
    );
    String rawMessage = objectMapper.writeValueAsString(
        EventEnvelope.create("procurement.invoice-approved", "301", payload, "procurement-service")
    );

    FinanceRepository.GoodsReceiptExpenseCandidate candidate = new FinanceRepository.GoodsReceiptExpenseCandidate(
        501L,
        9L,
        java.time.LocalDate.parse("2026-03-27"),
        "USD",
        new BigDecimal("100.00")
    );
    FinanceRepository.ExpenseRecord createdExpense = new FinanceRepository.ExpenseRecord(
        601L,
        9L,
        java.time.LocalDate.parse("2026-03-27"),
        "USD",
        new BigDecimal("100.00"),
        "inventory_purchase",
        "Auto-created from supplier invoice 301",
        null,
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-27T00:00:00Z"),
        "inventory_purchase",
        null
    );

    when(idGenerator.generateId()).thenReturn(601L);
    when(financeRepository.findGoodsReceiptExpenseCandidate(501L)).thenReturn(java.util.Optional.of(candidate));
    when(financeRepository.createInventoryPurchaseExpense(601L, candidate, null, "Auto-created from supplier invoice 301"))
        .thenReturn(createdExpense);
    when(idempotencyGuard.execute(eq("finance-service"), any(), eq(rawMessage), any(), any()))
        .thenAnswer(invocation -> ((Supplier<IdempotencyResult>) invocation.getArgument(4)).get());

    consumer.handleInvoiceApproved(rawMessage);

    verify(financeRepository).createInventoryPurchaseExpense(601L, candidate, null, "Auto-created from supplier invoice 301");
    verify(eventPublisher).publish(
        eq("fern.finance.expense-record-created"),
        eq("601"),
        eq("finance.expense-record-created"),
        any()
    );
  }
}
