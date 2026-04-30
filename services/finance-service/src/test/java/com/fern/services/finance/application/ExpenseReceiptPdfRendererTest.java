package com.fern.services.finance.application;

import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fern.services.finance.infrastructure.FinanceRepository;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;

class ExpenseReceiptPdfRendererTest {

  @Test
  void renderCreatesPdfBytes() {
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

    byte[] pdf = new ExpenseReceiptPdfRenderer().render(expense, 900L, Instant.parse("2026-03-27T00:00:00Z"));

    assertTrue(pdf.length > 100);
    assertTrue(new String(pdf, 0, 4, StandardCharsets.US_ASCII).startsWith("%PDF"));
  }
}
