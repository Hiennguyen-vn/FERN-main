package com.fern.services.finance.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.dorabets.common.spring.events.TypedKafkaEventPublisher;
import com.dorabets.common.spring.web.PagedResult;
import com.fern.events.finance.ExpenseRecordCreatedEvent;
import com.fern.services.finance.api.FinanceDtos;
import com.fern.services.finance.infrastructure.FinanceRepository;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class FinanceServiceTest {

  @Mock
  private FinanceRepository financeRepository;
  @Mock
  private SnowflakeIdGenerator idGenerator;
  @Mock
  private TypedKafkaEventPublisher eventPublisher;

  private final Clock clock = Clock.fixed(Instant.parse("2026-03-27T00:00:00Z"), ZoneOffset.UTC);

  @AfterEach
  void clearContext() {
    RequestUserContextHolder.clear();
  }

  @Test
  void createOperatingExpenseUsesSnowflakeAndPublishesEvent() {
    RequestUserContextHolder.set(new RequestUserContext(
        9L, "admin", "sess-9", Set.of("admin"), Set.of(), Set.of(7L), true, false, null
    ));
    when(idGenerator.generateId()).thenReturn(501L);
    when(financeRepository.createOperatingExpense(
        501L,
        7L,
        LocalDate.parse("2026-03-27"),
        "USD",
        new BigDecimal("12.50"),
        "supplies",
        9L,
        "Cleaning supplies"
    )).thenReturn(new FinanceRepository.ExpenseRecord(
        501L,
        7L,
        LocalDate.parse("2026-03-27"),
        "USD",
        new BigDecimal("12.50"),
        "operating_expense",
        "supplies",
        9L,
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-27T00:00:00Z"),
        "operating",
        "Cleaning supplies"
    ));

    FinanceService service = new FinanceService(financeRepository, idGenerator, eventPublisher, clock);
    FinanceDtos.ExpenseView result = service.createOperatingExpense(new FinanceDtos.CreateOperatingExpenseRequest(
        7L,
        LocalDate.parse("2026-03-27"),
        "USD",
        new BigDecimal("12.50"),
        "Cleaning supplies",
        "supplies"
    ));

    verify(eventPublisher).publish(
        eq("fern.finance.expense-record-created"),
        eq("501"),
        eq("finance.expense-record-created"),
        any(ExpenseRecordCreatedEvent.class)
    );
    assertEquals(501L, result.id());
    assertEquals("operating_expense", result.sourceType());
  }

  @Test
  void createOtherExpenseUsesSnowflakeAndPublishesEvent() {
    RequestUserContextHolder.set(new RequestUserContext(
        null, null, null, Set.of(), Set.of(), Set.of(), false, true, "audit-service"
    ));
    when(idGenerator.generateId()).thenReturn(502L);
    when(financeRepository.createOtherExpense(
        502L,
        7L,
        LocalDate.parse("2026-03-27"),
        "USD",
        new BigDecimal("20.00"),
        "misc",
        null,
        "Bank fee"
    )).thenReturn(new FinanceRepository.ExpenseRecord(
        502L,
        7L,
        LocalDate.parse("2026-03-27"),
        "USD",
        new BigDecimal("20.00"),
        "operating_expense",
        "misc",
        null,
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-27T00:00:00Z"),
        "other",
        "Bank fee"
    ));

    FinanceService service = new FinanceService(financeRepository, idGenerator, eventPublisher, clock);
    FinanceDtos.ExpenseView result = service.createOtherExpense(new FinanceDtos.CreateOtherExpenseRequest(
        7L,
        LocalDate.parse("2026-03-27"),
        "USD",
        new BigDecimal("20.00"),
        "Bank fee",
        "misc"
    ));

    verify(eventPublisher).publish(
        eq("fern.finance.expense-record-created"),
        eq("502"),
        eq("finance.expense-record-created"),
        any(ExpenseRecordCreatedEvent.class)
    );
    assertEquals("other", result.subtype());
  }

  @Test
  void listExpensesRejectsNonAdminUsers() {
    RequestUserContextHolder.set(new RequestUserContext(
        11L, "workflow.hcm.manager", "sess-11", Set.of("outlet_manager"), Set.of(), Set.of(2000L), true, false, null
    ));
    FinanceService service = new FinanceService(financeRepository, idGenerator, eventPublisher, clock);

    ServiceException exception = assertThrows(ServiceException.class, () -> service.listExpenses(
        2000L,
        LocalDate.parse("2026-03-01"),
        LocalDate.parse("2026-03-31"),
        "operating_expense",
        null,
        null,
        null,
        20,
        0
    ));

    assertEquals(403, exception.getStatusCode());
  }

  @Test
  void listExpensesDelegatesLimitAndOffsetForAdmin() {
    RequestUserContextHolder.set(new RequestUserContext(
        9L, "admin", "sess-9", Set.of("admin"), Set.of(), Set.of(7L), true, false, null
    ));
    when(financeRepository.listExpenses(
        7L,
        LocalDate.parse("2026-03-01"),
        LocalDate.parse("2026-03-31"),
        "operating_expense",
        null,
        null,
        null,
        100,
        15
    )).thenReturn(PagedResult.of(java.util.List.of(), 100, 15, 0));

    FinanceService service = new FinanceService(financeRepository, idGenerator, eventPublisher, clock);
    service.listExpenses(
        7L,
        LocalDate.parse("2026-03-01"),
        LocalDate.parse("2026-03-31"),
        "operating_expense",
        null,
        null,
        null,
        500,
        15
    );

    verify(financeRepository).listExpenses(
        7L,
        LocalDate.parse("2026-03-01"),
        LocalDate.parse("2026-03-31"),
        "operating_expense",
        null,
        null,
        null,
        100,
        15
    );
  }
}
