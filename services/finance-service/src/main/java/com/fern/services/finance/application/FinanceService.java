package com.fern.services.finance.application;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.dorabets.common.spring.events.TypedKafkaEventPublisher;
import com.dorabets.common.spring.web.PagedResult;
import com.dorabets.common.spring.web.QueryConventions;
import com.fern.events.finance.ExpenseRecordCreatedEvent;
import com.fern.services.finance.api.FinanceDtos;
import com.fern.services.finance.infrastructure.FinanceRepository;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import java.time.Clock;
import java.time.LocalDate;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class FinanceService {

  private final FinanceRepository financeRepository;
  private final SnowflakeIdGenerator idGenerator;
  private final TypedKafkaEventPublisher eventPublisher;
  private final Clock clock;

  public FinanceService(
      FinanceRepository financeRepository,
      SnowflakeIdGenerator idGenerator,
      TypedKafkaEventPublisher eventPublisher,
      Clock clock
  ) {
    this.financeRepository = financeRepository;
    this.idGenerator = idGenerator;
    this.eventPublisher = eventPublisher;
    this.clock = clock;
  }

  public FinanceDtos.ExpenseView createOperatingExpense(FinanceDtos.CreateOperatingExpenseRequest request) {
    requireFinanceWrite();
    long expenseId = idGenerator.generateId();
    FinanceRepository.ExpenseRecord record = financeRepository.createOperatingExpense(
        expenseId,
        request.outletId(),
        request.businessDate(),
        request.currencyCode().trim(),
        request.amount(),
        trimToNull(request.note()),
        RequestUserContextHolder.get().userId(),
        request.description().trim()
    );
    publishExpenseCreated(record, expenseId);
    return toDto(record);
  }

  public FinanceDtos.ExpenseView createOtherExpense(FinanceDtos.CreateOtherExpenseRequest request) {
    requireFinanceWrite();
    long expenseId = idGenerator.generateId();
    FinanceRepository.ExpenseRecord record = financeRepository.createOtherExpense(
        expenseId,
        request.outletId(),
        request.businessDate(),
        request.currencyCode().trim(),
        request.amount(),
        trimToNull(request.note()),
        RequestUserContextHolder.get().userId(),
        request.description().trim()
    );
    publishExpenseCreated(record, expenseId);
    return toDto(record);
  }

  public FinanceDtos.ExpenseView getExpense(long expenseId) {
    requireFinanceRead();
    return financeRepository.findExpense(expenseId)
        .map(this::toDto)
        .orElseThrow(() -> ServiceException.notFound("Expense not found: " + expenseId));
  }

  public PagedResult<FinanceDtos.ExpenseView> listExpenses(
      Long outletId,
      LocalDate startDate,
      LocalDate endDate,
      String sourceType,
      String q,
      String sortBy,
      String sortDir,
      Integer limit,
      Integer offset
  ) {
    requireFinanceRead();
    return financeRepository.listExpenses(
            outletId,
            startDate,
            endDate,
            sourceType,
            QueryConventions.normalizeQuery(q),
            sortBy,
            sortDir,
            sanitizeLimit(limit),
            sanitizeOffset(offset)
        ).map(this::toDto);
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

  private void requireFinanceWrite() {
    RequestUserContext context = RequestUserContextHolder.get();
    if (context.internalService() || context.hasRole("admin") || context.hasRole("superadmin")) {
      return;
    }
    context.requireUserId();
    throw ServiceException.forbidden("Finance write access is required");
  }

  private void requireFinanceRead() {
    RequestUserContext context = RequestUserContextHolder.get();
    if (context.internalService() || context.hasRole("admin") || context.hasRole("superadmin")) {
      return;
    }
    context.requireUserId();
    throw ServiceException.forbidden("Finance read access is required");
  }

  private static String trimToNull(String value) {
    if (value == null) {
      return null;
    }
    String trimmed = value.trim();
    return trimmed.isEmpty() ? null : trimmed;
  }

  private FinanceDtos.ExpenseView toDto(FinanceRepository.ExpenseRecord record) {
    return new FinanceDtos.ExpenseView(
        record.id(),
        record.outletId(),
        record.businessDate(),
        record.currencyCode(),
        record.amount(),
        record.sourceType(),
        record.subtype(),
        record.description(),
        record.createdByUserId(),
        record.createdAt(),
        record.updatedAt()
    );
  }

  private int sanitizeLimit(Integer limit) {
    return QueryConventions.sanitizeLimit(limit, 50, 100);
  }

  private int sanitizeOffset(Integer offset) {
    return QueryConventions.sanitizeOffset(offset);
  }
}
