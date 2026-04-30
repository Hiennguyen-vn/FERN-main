package com.fern.services.finance.application;

import com.fern.services.finance.infrastructure.FinanceRepository;
import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.springframework.stereotype.Component;

@Component
public class ExpenseReceiptPdfRenderer {

  private static final PDType1Font FONT = new PDType1Font(Standard14Fonts.FontName.HELVETICA);
  private static final PDType1Font FONT_BOLD = new PDType1Font(Standard14Fonts.FontName.HELVETICA_BOLD);
  private static final DateTimeFormatter GENERATED_AT_FORMAT =
      DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm 'UTC'").withZone(ZoneOffset.UTC);

  public byte[] render(FinanceRepository.ExpenseRecord expense, long documentId, Instant generatedAt) {
    try (PDDocument document = new PDDocument(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
      PDPage page = new PDPage(PDRectangle.A4);
      document.addPage(page);
      try (PDPageContentStream content = new PDPageContentStream(document, page)) {
        float y = 780;
        y = writeLine(content, "FERN OPERATING EXPENSE RECEIPT", 50, y, FONT_BOLD, 18, 24);
        y = writeLine(content, "Document ID: " + documentId, 50, y, FONT, 10, 16);
        y = writeLine(content, "Generated: " + GENERATED_AT_FORMAT.format(generatedAt), 50, y, FONT, 10, 28);

        y = writeSection(content, "Expense", y);
        y = writeLine(content, "Expense ID: " + expense.id(), 50, y, FONT, 11, 16);
        y = writeLine(content, "Outlet ID: " + expense.outletId(), 50, y, FONT, 11, 16);
        y = writeLine(content, "Business date: " + expense.businessDate(), 50, y, FONT, 11, 16);
        y = writeLine(content, "Source: " + readable(expense.sourceType()) + " / " + readable(expense.subtype()), 50, y, FONT, 11, 16);
        y = writeLine(content, "Amount: " + formatAmount(expense.amount(), expense.currencyCode()), 50, y, FONT_BOLD, 12, 26);

        y = writeSection(content, "Description", y);
        for (String line : wrap(readable(expense.description()), 88)) {
          y = writeLine(content, line, 50, y, FONT, 11, 15);
        }

        if (expense.note() != null && !expense.note().isBlank()) {
          y -= 10;
          y = writeSection(content, "Note", y);
          for (String line : wrap(expense.note(), 88)) {
            y = writeLine(content, line, 50, y, FONT, 11, 15);
          }
        }

        y -= 18;
        content.setStrokingColor(new Color(210, 214, 220));
        content.moveTo(50, y);
        content.lineTo(545, y);
        content.stroke();
        y -= 18;
        writeLine(content, "This document was generated from the finance ledger and stored in object storage.", 50, y, FONT, 9, 12);
      }
      document.save(output);
      return output.toByteArray();
    } catch (IOException ex) {
      throw new IllegalStateException("Unable to render expense receipt PDF", ex);
    }
  }

  private static float writeSection(PDPageContentStream content, String label, float y) throws IOException {
    return writeLine(content, label, 50, y, FONT_BOLD, 13, 18);
  }

  private static float writeLine(
      PDPageContentStream content,
      String text,
      float x,
      float y,
      PDType1Font font,
      float fontSize,
      float lineHeight
  ) throws IOException {
    content.beginText();
    content.setFont(font, fontSize);
    content.newLineAtOffset(x, y);
    content.showText(toPdfText(text));
    content.endText();
    return y - lineHeight;
  }

  private static String formatAmount(BigDecimal amount, String currencyCode) {
    BigDecimal normalized = amount == null ? BigDecimal.ZERO : amount;
    return readable(currencyCode) + " " + normalized.toPlainString();
  }

  private static String readable(String value) {
    return value == null || value.isBlank() ? "-" : value;
  }

  private static String toPdfText(String text) {
    return readable(text)
        .replace('\n', ' ')
        .replace('\r', ' ')
        .replace('\t', ' ')
        .replaceAll("[^\\x20-\\x7E]", "?");
  }

  private static List<String> wrap(String text, int maxLength) {
    String clean = toPdfText(text);
    if (clean.length() <= maxLength) {
      return List.of(clean);
    }
    List<String> lines = new ArrayList<>();
    int start = 0;
    while (start < clean.length()) {
      int end = Math.min(start + maxLength, clean.length());
      if (end < clean.length()) {
        int space = clean.lastIndexOf(' ', end);
        if (space > start) {
          end = space;
        }
      }
      lines.add(clean.substring(start, end).trim());
      start = end;
      while (start < clean.length() && clean.charAt(start) == ' ') {
        start += 1;
      }
    }
    return lines;
  }
}
