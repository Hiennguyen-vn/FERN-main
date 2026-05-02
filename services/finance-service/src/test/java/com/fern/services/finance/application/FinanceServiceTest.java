package com.fern.services.finance.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fern.common.middleware.ServiceException;
import com.fern.common.spring.auth.AuthorizationPolicyService;
import com.fern.common.spring.auth.RequestUserContext;
import com.fern.common.spring.auth.RequestUserContextHolder;
import com.fern.common.spring.web.PagedResult;
import com.fern.events.finance.ExpenseRecordCreatedEvent;
import com.fern.services.finance.api.FinanceDtos;
import com.fern.services.finance.infrastructure.ExpenseDocumentStorage;
import com.fern.services.finance.infrastructure.FinanceRepository;
import com.fern.common.utils.services.id.SnowflakeIdGenerator;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
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
  private AuthorizationPolicyService authorizationPolicyService;
  @Mock
  private ExpenseDocumentStorage expenseDocumentStorage;
  @Mock
  private ExpenseReceiptPdfRenderer expenseReceiptPdfRenderer;

  private final Clock clock = Clock.fixed(Instant.parse("2026-03-27T00:00:00Z"), ZoneOffset.UTC);

  @AfterEach
  void clearContext() {
    RequestUserContextHolder.clear();
  }

  @Test
  void createOperatingExpenseUsesSnowflakeAndPublishesEvent() {
    RequestUserContextHolder.set(new RequestUserContext(
        9L, "admin", "sess-9", Set.of("admin"), Set.of(), Set.of(7L), true, false, null
    , null, null));
    when(authorizationPolicyService.canWriteFinanceForOutlet(any(), eq(7L))).thenReturn(true);
    when(idGenerator.generateId()).thenReturn(501L);
    when(financeRepository.createOperatingExpense(
        eq(501L),
        eq(7L),
        eq(LocalDate.parse("2026-03-27")),
        eq("USD"),
        eq(new BigDecimal("12.50")),
        eq("supplies"),
        eq(9L),
        eq("Cleaning supplies"),
        any(ExpenseRecordCreatedEvent.class)
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

    FinanceService service = new FinanceService(financeRepository, idGenerator, authorizationPolicyService, clock);
    FinanceDtos.ExpenseView result = service.createOperatingExpense(new FinanceDtos.CreateOperatingExpenseRequest(
        7L,
        LocalDate.parse("2026-03-27"),
        "USD",
        new BigDecimal("12.50"),
        "Cleaning supplies",
        "supplies"
    ));

    verify(financeRepository).createOperatingExpense(
        eq(501L), eq(7L), any(), any(), any(), any(), any(), any(),
        any(ExpenseRecordCreatedEvent.class)
    );
    assertEquals(501L, result.id());
    assertEquals("operating_expense", result.sourceType());
  }

  @Test
  void createOtherExpenseUsesSnowflakeAndPublishesEvent() {
    when(authorizationPolicyService.canWriteFinanceForOutlet(any(), eq(7L))).thenReturn(true);
    RequestUserContextHolder.set(new RequestUserContext(
        null, null, null, Set.of(), Set.of(), Set.of(), false, true, "audit-service"
    , null, null));
    when(idGenerator.generateId()).thenReturn(502L);
    when(financeRepository.createOtherExpense(
        eq(502L),
        eq(7L),
        eq(LocalDate.parse("2026-03-27")),
        eq("USD"),
        eq(new BigDecimal("20.00")),
        eq("misc"),
        org.mockito.ArgumentMatchers.<Long>isNull(),
        eq("Bank fee"),
        any(ExpenseRecordCreatedEvent.class)
    )).thenReturn(new FinanceRepository.ExpenseRecord(
        502L,
        7L,
        LocalDate.parse("2026-03-27"),
        "USD",
        new BigDecimal("20.00"),
        "other",
        "misc",
        null,
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-27T00:00:00Z"),
        "other",
        "Bank fee"
    ));

    FinanceService service = new FinanceService(financeRepository, idGenerator, authorizationPolicyService, clock);
    FinanceDtos.ExpenseView result = service.createOtherExpense(new FinanceDtos.CreateOtherExpenseRequest(
        7L,
        LocalDate.parse("2026-03-27"),
        "USD",
        new BigDecimal("20.00"),
        "Bank fee",
        "misc"
    ));

    verify(financeRepository).createOtherExpense(
        eq(502L), eq(7L), any(), any(), any(), any(), any(), any(),
        any(ExpenseRecordCreatedEvent.class)
    );
    assertEquals("other", result.sourceType());
    assertEquals("other", result.subtype());
  }

  @Test
  void listExpensesRejectsNonAdminUsers() {
    RequestUserContextHolder.set(new RequestUserContext(
        11L, "workflow.hcm.manager", "sess-11", Set.of("outlet_manager"), Set.of(), Set.of(2000L), true, false, null
    , null, null));
    when(authorizationPolicyService.canReadFinance(any())).thenReturn(false);
    FinanceService service = new FinanceService(financeRepository, idGenerator, authorizationPolicyService, clock);

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
    , null, null));
    when(authorizationPolicyService.canReadFinance(any())).thenReturn(true);
    when(authorizationPolicyService.canReadFinanceForOutlet(any(), eq(7L))).thenReturn(true);
    when(financeRepository.listExpenses(
        Set.of(7L),
        LocalDate.parse("2026-03-01"),
        LocalDate.parse("2026-03-31"),
        "operating_expense",
        null,
        null,
        null,
        500,
        15
    )).thenReturn(PagedResult.of(java.util.List.of(), 500, 15, 0));

    FinanceService service = new FinanceService(financeRepository, idGenerator, authorizationPolicyService, clock);
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
        Set.of(7L),
        LocalDate.parse("2026-03-01"),
        LocalDate.parse("2026-03-31"),
        "operating_expense",
        null,
        null,
        null,
        500,
        15
    );
  }

  @Test
  void expenseSummaryDelegatesSameFiltersWithoutPagination() {
    RequestUserContextHolder.set(new RequestUserContext(
        9L, "admin", "sess-9", Set.of("admin"), Set.of(), Set.of(7L), true, false, null
    , null, null));
    when(authorizationPolicyService.canReadFinance(any())).thenReturn(true);
    when(authorizationPolicyService.canReadFinanceForOutlet(any(), eq(7L))).thenReturn(true);
    when(financeRepository.expenseSummary(
        Set.of(7L),
        LocalDate.parse("2026-03-01"),
        LocalDate.parse("2026-03-31"),
        "operating_expense",
        "rent"
    )).thenReturn(List.of(new FinanceDtos.ExpenseSummaryRow(
        "operating_expense",
        3L,
        new BigDecimal("250000.00"),
        "VND"
    )));

    FinanceService service = new FinanceService(financeRepository, idGenerator, authorizationPolicyService, clock);
    List<FinanceDtos.ExpenseSummaryRow> rows = service.expenseSummary(
        7L,
        LocalDate.parse("2026-03-01"),
        LocalDate.parse("2026-03-31"),
        "operating_expense",
        " rent "
    );

    assertEquals(1, rows.size());
    assertEquals(3L, rows.getFirst().recordCount());
    verify(financeRepository).expenseSummary(
        Set.of(7L),
        LocalDate.parse("2026-03-01"),
        LocalDate.parse("2026-03-31"),
        "operating_expense",
        "rent"
    );
  }

  @Test
  void getExpenseDetailIncludesSupplierInvoiceLinesForInventoryPurchase() {
    RequestUserContextHolder.set(new RequestUserContext(
        9L, "admin", "sess-9", Set.of("admin"), Set.of(), Set.of(7L), true, false, null
    , null, null));
    FinanceRepository.ExpenseRecord expense = new FinanceRepository.ExpenseRecord(
        501L,
        7L,
        LocalDate.parse("2026-03-27"),
        "VND",
        new BigDecimal("125000.00"),
        "inventory_purchase",
        "Auto-created from supplier invoice 301",
        9L,
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-27T00:00:00Z"),
        "inventory_purchase",
        null
    );
    FinanceDtos.SupplierInvoiceExpenseDetailView invoice = new FinanceDtos.SupplierInvoiceExpenseDetailView(
        301L,
        "SUP-INV-301",
        44L,
        "SUP-44",
        "Fresh Supplier",
        "VND",
        LocalDate.parse("2026-03-27"),
        LocalDate.parse("2026-04-03"),
        new BigDecimal("100000.00"),
        new BigDecimal("25000.00"),
        new BigDecimal("125000.00"),
        "approved",
        "supplier note",
        8L,
        9L,
        Instant.parse("2026-03-27T01:00:00Z"),
        Instant.parse("2026-03-27T00:30:00Z"),
        Instant.parse("2026-03-27T01:00:00Z"),
        701L,
        601L,
        "approved",
        "posted",
        Instant.parse("2026-03-27T00:20:00Z"),
        LocalDate.parse("2026-03-27"),
        new BigDecimal("125000.00"),
        "LOT-1",
        List.of(new FinanceDtos.SupplierInvoiceExpenseLineView(
            1,
            "goods",
            801L,
            901L,
            "ITEM-901",
            "Arabica beans",
            "kg",
            new BigDecimal("5.0000"),
            new BigDecimal("20000.0000"),
            new BigDecimal("25.00"),
            new BigDecimal("25000.00"),
            new BigDecimal("125000.00"),
            new BigDecimal("5.0000"),
            new BigDecimal("20000.0000"),
            new BigDecimal("100000.00"),
            "Arabica beans",
            null
        ))
    );
    when(authorizationPolicyService.canReadFinance(any())).thenReturn(true);
    when(authorizationPolicyService.canReadFinanceForOutlet(any(), eq(7L))).thenReturn(true);
    when(financeRepository.findExpense(501L)).thenReturn(Optional.of(expense));
    when(financeRepository.listExpenseDocuments(501L)).thenReturn(List.of());
    when(financeRepository.listSupplierInvoiceExpenseDetails(501L)).thenReturn(List.of(invoice));
    when(financeRepository.findInventoryReceiptExpenseDetail(501L)).thenReturn(Optional.empty());

    FinanceService service = new FinanceService(financeRepository, idGenerator, authorizationPolicyService, clock);
    FinanceDtos.ExpenseDetailView detail = service.getExpenseDetail(501L);

    assertEquals(501L, detail.expense().id());
    assertEquals("Auto-created from supplier invoice 301", detail.expense().note());
    assertEquals("SUP-INV-301", detail.supplierInvoice().invoiceNumber());
    assertEquals(1, detail.supplierInvoices().size());
    assertEquals(1, detail.supplierInvoice().lines().size());
    assertEquals("Arabica beans", detail.supplierInvoice().lines().getFirst().itemName());
    verify(financeRepository).listSupplierInvoiceExpenseDetails(501L);
  }

  @Test
  void exportExpensePdfRendersUploadsAndStoresDocumentRecord() {
    RequestUserContextHolder.set(new RequestUserContext(
        9L, "admin", "sess-9", Set.of("admin"), Set.of(), Set.of(7L), true, false, null
    , null, null));
    FinanceRepository.ExpenseRecord expense = new FinanceRepository.ExpenseRecord(
        501L,
        7L,
        LocalDate.parse("2026-03-27"),
        "VND",
        new BigDecimal("125000.00"),
        "operating_expense",
        "receipt note",
        9L,
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-27T00:00:00Z"),
        "operating",
        "Cleaning supplies"
    );
    byte[] pdf = new byte[] {37, 80, 68, 70};
    when(authorizationPolicyService.canReadFinance(any())).thenReturn(true);
    when(authorizationPolicyService.canReadFinanceForOutlet(any(), eq(7L))).thenReturn(true);
    when(financeRepository.findExpense(501L)).thenReturn(Optional.of(expense));
    when(idGenerator.generateId()).thenReturn(900L);
    when(expenseReceiptPdfRenderer.render(expense, 900L, clock.instant())).thenReturn(pdf);
    when(expenseDocumentStorage.upload(
        "finance/expenses/7/501/900.pdf",
        "expense-501.pdf",
        "application/pdf",
        pdf
    )).thenReturn(new ExpenseDocumentStorage.StoredObject(
        "finance/expenses/7/501/900.pdf",
        "https://storage.example/finance/expenses/7/501/900.pdf"
    ));
    when(financeRepository.createExpenseDocument(
        900L,
        501L,
        "expense_receipt_pdf",
        "expense-501.pdf",
        "application/pdf",
        "finance/expenses/7/501/900.pdf",
        "https://storage.example/finance/expenses/7/501/900.pdf",
        9L
    )).thenReturn(new FinanceRepository.ExpenseDocumentRecord(
        900L,
        501L,
        "expense_receipt_pdf",
        "expense-501.pdf",
        "application/pdf",
        "finance/expenses/7/501/900.pdf",
        "https://storage.example/finance/expenses/7/501/900.pdf",
        9L,
        Instant.parse("2026-03-27T00:00:00Z")
    ));
    when(expenseDocumentStorage.downloadUrl("finance/expenses/7/501/900.pdf"))
        .thenReturn("https://signed.example/finance/expenses/7/501/900.pdf");

    FinanceService service = new FinanceService(
        financeRepository,
        idGenerator,
        authorizationPolicyService,
        clock,
        expenseDocumentStorage,
        expenseReceiptPdfRenderer
    );

    FinanceDtos.ExpenseDocumentView document = service.exportExpensePdf(501L);

    assertEquals(900L, document.id());
    assertEquals(501L, document.expenseId());
    assertEquals("expense_receipt_pdf", document.documentType());
    assertEquals("https://signed.example/finance/expenses/7/501/900.pdf", document.url());
  }

  @Test
  void exportExpensePdfRequiresConfiguredDocumentStorage() {
    RequestUserContextHolder.set(new RequestUserContext(
        9L, "admin", "sess-9", Set.of("admin"), Set.of(), Set.of(7L), true, false, null
    , null, null));
    when(authorizationPolicyService.canReadFinance(any())).thenReturn(true);
    when(authorizationPolicyService.canReadFinanceForOutlet(any(), eq(7L))).thenReturn(true);
    when(financeRepository.findExpense(501L)).thenReturn(Optional.of(new FinanceRepository.ExpenseRecord(
        501L,
        7L,
        LocalDate.parse("2026-03-27"),
        "VND",
        new BigDecimal("125000.00"),
        "operating_expense",
        null,
        9L,
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-27T00:00:00Z"),
        "operating",
        "Cleaning supplies"
    )));

    FinanceService service = new FinanceService(financeRepository, idGenerator, authorizationPolicyService, clock);

    ServiceException exception = assertThrows(ServiceException.class, () -> service.exportExpensePdf(501L));

    assertEquals(409, exception.getStatusCode());
    assertEquals("EXPENSE_DOCUMENT_STORAGE_NOT_CONFIGURED", exception.getMessage());
  }
}
