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
import com.fern.services.finance.infrastructure.ExpenseDocumentStorage;
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
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

@Service
public class FinanceService {

  private final FinanceRepository financeRepository;
  private final SnowflakeIdGenerator idGenerator;
  private final TypedKafkaEventPublisher eventPublisher;
  private final AuthorizationPolicyService authorizationPolicyService;
  private final Clock clock;
  private final TieredCache<List<FinanceDtos.MonthlyExpenseRow>> monthlyExpenseCache;
  private final ExpenseDocumentStorage expenseDocumentStorage;
  private final ExpenseReceiptPdfRenderer expenseReceiptPdfRenderer;

  @Autowired
  public FinanceService(
      FinanceRepository financeRepository,
      SnowflakeIdGenerator idGenerator,
      TypedKafkaEventPublisher eventPublisher,
      AuthorizationPolicyService authorizationPolicyService,
      Clock clock,
      ObjectMapper objectMapper,
      RedisClientAdapter redisClientAdapter,
      ObjectProvider<ExpenseDocumentStorage> expenseDocumentStorageProvider,
      ExpenseReceiptPdfRenderer expenseReceiptPdfRenderer
  ) {
    this(
        financeRepository,
        idGenerator,
        eventPublisher,
        authorizationPolicyService,
        clock,
        objectMapper,
        redisClientAdapter,
        expenseDocumentStorageProvider == null ? null : expenseDocumentStorageProvider.getIfAvailable(),
        expenseReceiptPdfRenderer
    );
  }

  private FinanceService(
      FinanceRepository financeRepository,
      SnowflakeIdGenerator idGenerator,
      TypedKafkaEventPublisher eventPublisher,
      AuthorizationPolicyService authorizationPolicyService,
      Clock clock,
      ObjectMapper objectMapper,
      RedisClientAdapter redisClientAdapter,
      ExpenseDocumentStorage expenseDocumentStorage,
      ExpenseReceiptPdfRenderer expenseReceiptPdfRenderer
  ) {
    this.financeRepository = financeRepository;
    this.idGenerator = idGenerator;
    this.eventPublisher = eventPublisher;
    this.authorizationPolicyService = authorizationPolicyService;
    this.clock = clock;
    this.expenseDocumentStorage = expenseDocumentStorage;
    this.expenseReceiptPdfRenderer = expenseReceiptPdfRenderer == null ? new ExpenseReceiptPdfRenderer() : expenseReceiptPdfRenderer;
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
    this(
        financeRepository,
        idGenerator,
        eventPublisher,
        authorizationPolicyService,
        clock,
        new ObjectMapper(),
        null,
        (ExpenseDocumentStorage) null,
        new ExpenseReceiptPdfRenderer()
    );
  }

  FinanceService(
      FinanceRepository financeRepository,
      SnowflakeIdGenerator idGenerator,
      TypedKafkaEventPublisher eventPublisher,
      AuthorizationPolicyService authorizationPolicyService,
      Clock clock,
      ExpenseDocumentStorage expenseDocumentStorage,
      ExpenseReceiptPdfRenderer expenseReceiptPdfRenderer
  ) {
    this(
        financeRepository,
        idGenerator,
        eventPublisher,
        authorizationPolicyService,
        clock,
        new ObjectMapper(),
        null,
        expenseDocumentStorage,
        expenseReceiptPdfRenderer
    );
  }

  public FinanceDtos.ExpenseView createOperatingExpense(FinanceDtos.CreateOperatingExpenseRequest request) {
    requireFinanceWrite(request.outletId());
    requireOpenFinancePeriod(request.outletId(), request.businessDate());
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
    requireOpenFinancePeriod(request.outletId(), request.businessDate());
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
    return toDto(loadAuthorizedExpense(expenseId));
  }

  public FinanceDtos.ExpenseDetailView getExpenseDetail(long expenseId) {
    FinanceRepository.ExpenseRecord record = loadAuthorizedExpense(expenseId);
    List<FinanceDtos.SupplierInvoiceExpenseDetailView> supplierInvoices =
        financeRepository.listSupplierInvoiceExpenseDetails(expenseId);
    return new FinanceDtos.ExpenseDetailView(
        toDto(record),
        financeRepository.listExpenseDocuments(expenseId).stream().map(this::toDocumentDto).toList(),
        supplierInvoices.stream().findFirst().orElse(null),
        supplierInvoices,
        financeRepository.findInventoryReceiptExpenseDetail(expenseId).orElse(null)
    );
  }

  public FinanceDtos.ExpenseDocumentView exportExpensePdf(long expenseId) {
    FinanceRepository.ExpenseRecord record = loadAuthorizedExpense(expenseId);
    if (expenseDocumentStorage == null) {
      throw ServiceException.conflict("EXPENSE_DOCUMENT_STORAGE_NOT_CONFIGURED");
    }
    long documentId = idGenerator.generateId();
    String fileName = "expense-" + record.id() + ".pdf";
    String objectKey = "finance/expenses/" + record.outletId() + "/" + record.id() + "/" + documentId + ".pdf";
    byte[] pdf = expenseReceiptPdfRenderer.render(record, documentId, clock.instant());
    ExpenseDocumentStorage.StoredObject stored = expenseDocumentStorage.upload(
        objectKey,
        fileName,
        "application/pdf",
        pdf
    );
    FinanceRepository.ExpenseDocumentRecord document = financeRepository.createExpenseDocument(
        documentId,
        record.id(),
        "expense_receipt_pdf",
        fileName,
        "application/pdf",
        stored.objectKey(),
        stored.url(),
        RequestUserContextHolder.get().userId()
    );
    return toDocumentDto(document);
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

  public List<FinanceDtos.ExpenseSummaryRow> expenseSummary(
      Long outletId,
      LocalDate startDate,
      LocalDate endDate,
      String sourceType,
      String q
  ) {
    requireFinanceRead();
    Set<Long> scopedOutletIds = resolveReadableOutletIds(outletId);
    return financeRepository.expenseSummary(
        scopedOutletIds,
        startDate,
        endDate,
        sourceType,
        QueryConventions.normalizeQuery(q)
    );
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

  private FinanceRepository.ExpenseRecord loadAuthorizedExpense(long expenseId) {
    requireFinanceRead();
    FinanceRepository.ExpenseRecord record = financeRepository.findExpense(expenseId)
        .orElseThrow(() -> ServiceException.notFound("Expense not found: " + expenseId));
    requireFinanceRead(record.outletId());
    return record;
  }

  private void publishExpenseCreated(FinanceRepository.ExpenseRecord record, long sourceId) {
    RequestUserContext context = RequestUserContextHolder.get();
    String correlationId = currentCorrelationId();
    eventPublisher.publish(
        "fern.finance.expense-record-created",
        Long.toString(record.id()),
        "finance.expense-record-created",
        new ExpenseRecordCreatedEvent(
            record.id(),
            sourceId,
            record.amount(),
            record.currencyCode(),
            clock.instant(),
            record.id(),
            record.outletId(),
            context.userId(),
            context.username(),
            sortedRoles(context),
            correlationId,
            null
        ),
        correlationId
    );
  }

  private static List<String> sortedRoles(RequestUserContext context) {
    return context.roles().stream().sorted().toList();
  }

  private static String currentCorrelationId() {
    String correlationId = MDC.get("correlationId");
    return correlationId == null || correlationId.isBlank() ? null : correlationId;
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

  private void requireOpenFinancePeriod(long outletId, LocalDate businessDate) {
    if (financeRepository.isBusinessDateInClosedPeriod(outletId, businessDate)) {
      throw ServiceException.conflict("FISCAL_PERIOD_CLOSED");
    }
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
        record.note(),
        record.createdByUserId(),
        record.createdAt(),
        record.updatedAt()
    );
  }

  private FinanceDtos.ExpenseDocumentView toDocumentDto(FinanceRepository.ExpenseDocumentRecord record) {
    String url = record.storageUrl();
    if (expenseDocumentStorage != null && record.objectKey() != null && !record.objectKey().isBlank()) {
      try {
        url = expenseDocumentStorage.downloadUrl(record.objectKey());
      } catch (RuntimeException ignored) {
        url = record.storageUrl();
      }
    }
    return new FinanceDtos.ExpenseDocumentView(
        record.id(),
        record.expenseRecordId(),
        record.documentType(),
        record.fileName(),
        record.contentType(),
        record.objectKey(),
        url,
        record.createdByUserId(),
        record.createdAt()
    );
  }

  private int sanitizeLimit(Integer limit) {
    return QueryConventions.sanitizeLimit(limit, 50, 500);
  }

  private int sanitizeOffset(Integer offset) {
    return QueryConventions.sanitizeOffset(offset);
  }
}
