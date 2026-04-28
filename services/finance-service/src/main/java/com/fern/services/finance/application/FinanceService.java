package com.fern.services.finance.application;

import com.fern.common.middleware.ServiceException;
import com.fern.common.spring.auth.AuthorizationPolicyService;
import com.fern.common.spring.auth.RequestUserContext;
import com.fern.common.spring.auth.RequestUserContextHolder;
import com.fern.common.spring.cache.JacksonCacheSerializer;
import com.fern.common.spring.events.TypedKafkaEventPublisher;
import com.fern.common.spring.web.PagedResult;
import com.fern.common.spring.web.QueryConventions;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fern.events.finance.ExpenseRecordCreatedEvent;
import com.fern.services.finance.api.FinanceDtos;
import com.fern.services.finance.infrastructure.FinanceRepository;
import com.fern.common.model.cache.RedisClientAdapter;
import com.fern.common.model.cache.TieredCache;
import com.fern.common.utils.services.id.SnowflakeIdGenerator;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDate;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class FinanceService {

  private final FinanceRepository financeRepository;
  private final SnowflakeIdGenerator idGenerator;
  private final TypedKafkaEventPublisher eventPublisher;
  private final AuthorizationPolicyService authorizationPolicyService;
  private final Clock clock;
  private final TieredCache<List<FinanceDtos.MonthlyExpenseRow>> monthlyExpenseCache;

  @Autowired
  public FinanceService(
      FinanceRepository financeRepository,
      SnowflakeIdGenerator idGenerator,
      TypedKafkaEventPublisher eventPublisher,
      AuthorizationPolicyService authorizationPolicyService,
      Clock clock,
      ObjectMapper objectMapper,
      RedisClientAdapter redisClientAdapter
  ) {
    this.financeRepository = financeRepository;
    this.idGenerator = idGenerator;
    this.eventPublisher = eventPublisher;
    this.authorizationPolicyService = authorizationPolicyService;
    this.clock = clock;
    this.monthlyExpenseCache = redisClientAdapter == null
        ? null
        : TieredCache.<List<FinanceDtos.MonthlyExpenseRow>>builder("fern-finance-monthly-expenses")
            .localMaxSize(1_000)
            .localTtl(Duration.ofMinutes(1))
            .redisTtl(Duration.ofMinutes(10))
            .redisClient(redisClientAdapter)
            .serializer(new JacksonCacheSerializer<>(
                objectMapper,
                new TypeReference<List<FinanceDtos.MonthlyExpenseRow>>() { }
            ))
            .build();
  }

  public FinanceService(
      FinanceRepository financeRepository,
      SnowflakeIdGenerator idGenerator,
      TypedKafkaEventPublisher eventPublisher,
      AuthorizationPolicyService authorizationPolicyService,
      Clock clock
  ) {
    this(financeRepository, idGenerator, eventPublisher, authorizationPolicyService, clock, new ObjectMapper(), null);
  }

  public FinanceDtos.ExpenseView createOperatingExpense(FinanceDtos.CreateOperatingExpenseRequest request) {
    requireFinanceWrite(request.outletId());
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
    evictMonthlyExpenseCache();
    return toDto(record);
  }

  public FinanceDtos.ExpenseView createOtherExpense(FinanceDtos.CreateOtherExpenseRequest request) {
    requireFinanceWrite(request.outletId());
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
    evictMonthlyExpenseCache();
    return toDto(record);
  }

  public FinanceDtos.ExpenseView getExpense(long expenseId) {
    requireFinanceRead();
    FinanceRepository.ExpenseRecord record = financeRepository.findExpense(expenseId)
        .orElseThrow(() -> ServiceException.notFound("Expense not found: " + expenseId));
    requireFinanceRead(record.outletId());
    return toDto(record);
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
    Set<Long> scopedOutletIds = resolveReadableOutletIds(outletId);
    return financeRepository.listExpenses(
            scopedOutletIds,
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

  public List<FinanceDtos.MonthlyExpenseRow> monthlyExpenses(
      Long outletId,
      LocalDate startDate,
      LocalDate endDate
  ) {
    requireFinanceRead();
    Set<Long> scopedOutletIds = resolveReadableOutletIds(outletId);
    if (monthlyExpenseCache == null) {
      return financeRepository.monthlyExpenses(scopedOutletIds, startDate, endDate);
    }
    String key = "outlets:" + cacheOutletKey(scopedOutletIds)
        + "|start:" + (startDate == null ? "" : startDate)
        + "|end:" + (endDate == null ? "" : endDate);
    return monthlyExpenseCache.getOrCompute(
        key,
        () -> financeRepository.monthlyExpenses(scopedOutletIds, startDate, endDate),
        Duration.ofMinutes(10)
    );
  }

  public void evictMonthlyExpenseCache() {
    // Simplest correct-by-construction: wipe all. Monthly totals small, recompute cheap.
    if (monthlyExpenseCache != null) monthlyExpenseCache.clearLocal();
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

  private void requireFinanceWrite(long outletId) {
    RequestUserContext context = RequestUserContextHolder.get();
    if (authorizationPolicyService.canWriteFinanceForOutlet(context, outletId)) {
      return;
    }
    throw ServiceException.forbidden("Finance write access denied for outlet " + outletId);
  }

  private void requireFinanceRead() {
    RequestUserContext context = RequestUserContextHolder.get();
    if (authorizationPolicyService.canReadFinance(context)) {
      return;
    }
    throw ServiceException.forbidden("Finance read access is required");
  }

  private void requireFinanceRead(long outletId) {
    RequestUserContext context = RequestUserContextHolder.get();
    if (authorizationPolicyService.canReadFinanceForOutlet(context, outletId)) {
      return;
    }
    throw ServiceException.forbidden("Finance read access denied for outlet " + outletId);
  }

  private Set<Long> resolveReadableOutletIds(Long requestedOutletId) {
    RequestUserContext context = RequestUserContextHolder.get();
    if (!authorizationPolicyService.canReadFinance(context)) {
      throw ServiceException.forbidden("Finance read access is required");
    }
    if (requestedOutletId != null) {
      requireFinanceRead(requestedOutletId);
      return Set.of(requestedOutletId);
    }
    Set<Long> readable = authorizationPolicyService.resolveFinanceReadableOutletIds(context);
    if (readable == null) {
      return null;
    }
    return Set.copyOf(new LinkedHashSet<>(readable));
  }

  private String cacheOutletKey(Set<Long> outletIds) {
    if (outletIds == null) {
      return "all";
    }
    if (outletIds.isEmpty()) {
      return "none";
    }
    return outletIds.stream().sorted().map(String::valueOf).reduce((a, b) -> a + "," + b).orElse("none");
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
    return QueryConventions.sanitizeLimit(limit, 50, 500);
  }

  private int sanitizeOffset(Integer offset) {
    return QueryConventions.sanitizeOffset(offset);
  }
}
