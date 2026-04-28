package com.fern.services.finance.infrastructure;

import com.fern.common.repository.BaseRepository;
import com.fern.services.finance.api.FinanceDtos;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import javax.sql.DataSource;
import org.springframework.stereotype.Repository;

@Repository
public class InvoiceRepository extends BaseRepository {

  public record OutletInfo(String code, String name, String address, String taxCode) {}

  public record InvoiceRecord(
      long id,
      long outletId,
      long saleId,
      String invoiceNumber,
      int invoiceYear,
      long invoiceSerial,
      Instant issuedAt,
      String sellerTaxCode,
      String sellerName,
      String sellerAddress,
      String buyerName,
      String buyerPhone,
      long subtotalCents,
      long vatCents,
      long totalCents,
      String totalInWords,
      String paymentMethod,
      String currency,
      String cqtStatus,
      String templateVersion,
      Instant createdAt
  ) {}

  public record InvoiceLineRecord(
      long id,
      long invoiceId,
      int lineNo,
      String productCode,
      String productName,
      String unit,
      BigDecimal qty,
      long unitPriceCents,
      long discountCents,
      BigDecimal vatPercent,
      long vatCents,
      long amountCents
  ) {}

  public InvoiceRepository(DataSource dataSource) {
    super(dataSource);
  }

  public Optional<InvoiceRecord> findBySaleId(long saleId) {
    return queryOne(
        "SELECT * FROM finance.invoice WHERE sale_id = ?",
        this::mapInvoice,
        saleId
    );
  }

  public Optional<InvoiceRecord> findById(long invoiceId) {
    return queryOne(
        "SELECT * FROM finance.invoice WHERE id = ?",
        this::mapInvoice,
        invoiceId
    );
  }

  public List<InvoiceLineRecord> findLinesByInvoiceId(long invoiceId) {
    return queryList(
        "SELECT * FROM finance.invoice_line WHERE invoice_id = ? ORDER BY line_no",
        this::mapLine,
        invoiceId
    );
  }

  /** SELECT FOR UPDATE — atomically reserves and returns the next serial for outlet/year. */
  public long nextSerial(long outletId, int year) {
    return executeInTransaction(conn -> {
      // Ensure row exists
      try (var ps = conn.prepareStatement(
          "INSERT INTO finance.outlet_invoice_sequence (outlet_id, year, next_serial) VALUES (?, ?, 1) " +
          "ON CONFLICT (outlet_id, year) DO NOTHING")) {
        ps.setLong(1, outletId);
        ps.setInt(2, year);
        ps.executeUpdate();
      }
      long serial;
      try (var ps = conn.prepareStatement(
          "SELECT next_serial FROM finance.outlet_invoice_sequence WHERE outlet_id = ? AND year = ? FOR UPDATE")) {
        ps.setLong(1, outletId);
        ps.setInt(2, year);
        try (var rs = ps.executeQuery()) {
          rs.next();
          serial = rs.getLong(1);
        }
      }
      try (var ps = conn.prepareStatement(
          "UPDATE finance.outlet_invoice_sequence SET next_serial = next_serial + 1 WHERE outlet_id = ? AND year = ?")) {
        ps.setLong(1, outletId);
        ps.setInt(2, year);
        ps.executeUpdate();
      }
      return serial;
    });
  }

  public void insertInvoice(InvoiceRecord inv, List<InvoiceLineRecord> lines) {
    executeInTransaction(conn -> {
      try (var ps = conn.prepareStatement(
          "INSERT INTO finance.invoice (id,outlet_id,sale_id,invoice_number,invoice_year,invoice_serial," +
          "issued_at,seller_tax_code,seller_name,seller_address,buyer_name,buyer_phone," +
          "subtotal_cents,vat_cents,total_cents,total_in_words,payment_method,currency,cqt_status,template_version) " +
          "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")) {
        ps.setLong(1, inv.id());
        ps.setLong(2, inv.outletId());
        ps.setLong(3, inv.saleId());
        ps.setString(4, inv.invoiceNumber());
        ps.setInt(5, inv.invoiceYear());
        ps.setLong(6, inv.invoiceSerial());
        ps.setTimestamp(7, Timestamp.from(inv.issuedAt()));
        ps.setString(8, inv.sellerTaxCode());
        ps.setString(9, inv.sellerName());
        ps.setString(10, inv.sellerAddress());
        ps.setString(11, inv.buyerName());
        ps.setString(12, inv.buyerPhone());
        ps.setLong(13, inv.subtotalCents());
        ps.setLong(14, inv.vatCents());
        ps.setLong(15, inv.totalCents());
        ps.setString(16, inv.totalInWords());
        ps.setString(17, inv.paymentMethod());
        ps.setString(18, inv.currency());
        ps.setString(19, inv.cqtStatus());
        ps.setString(20, inv.templateVersion());
        ps.executeUpdate();
      }
      for (InvoiceLineRecord line : lines) {
        try (var ps = conn.prepareStatement(
            "INSERT INTO finance.invoice_line (invoice_id,line_no,product_code,product_name,unit,qty," +
            "unit_price_cents,discount_cents,vat_percent,vat_cents,amount_cents) VALUES (?,?,?,?,?,?,?,?,?,?,?)")) {
          ps.setLong(1, line.invoiceId());
          ps.setInt(2, line.lineNo());
          ps.setString(3, line.productCode());
          ps.setString(4, line.productName());
          ps.setString(5, line.unit());
          ps.setBigDecimal(6, line.qty());
          ps.setLong(7, line.unitPriceCents());
          ps.setLong(8, line.discountCents());
          ps.setBigDecimal(9, line.vatPercent());
          ps.setLong(10, line.vatCents());
          ps.setLong(11, line.amountCents());
          ps.executeUpdate();
        }
      }
      return null;
    });
  }

  public Optional<OutletInfo> findOutletInfo(long outletId) {
    return queryOne(
        "SELECT code, name, address, tax_code FROM core.outlet WHERE id = ?",
        rs -> {
          try {
            return new OutletInfo(
                rs.getString("code"),
                rs.getString("name"),
                rs.getString("address"),
                rs.getString("tax_code")
            );
          } catch (SQLException e) {
            throw new RuntimeException(e);
          }
        },
        outletId
    );
  }

  public List<FinanceDtos.InvoiceSummary> listInvoices(
      long outletId, Instant from, Instant to, int limit, int offset) {
    return queryList(
        "SELECT id,outlet_id,sale_id,invoice_number,issued_at,total_cents,cqt_status FROM finance.invoice " +
        "WHERE outlet_id = ? AND issued_at >= ? AND issued_at < ? ORDER BY issued_at DESC LIMIT ? OFFSET ?",
        rs -> {
          try {
            return new FinanceDtos.InvoiceSummary(
                rs.getLong("id"),
                rs.getLong("outlet_id"),
                rs.getLong("sale_id"),
                rs.getString("invoice_number"),
                rs.getTimestamp("issued_at").toInstant(),
                rs.getLong("total_cents"),
                rs.getString("cqt_status")
            );
          } catch (SQLException e) {
            throw new RuntimeException(e);
          }
        },
        outletId,
        Timestamp.from(from),
        Timestamp.from(to),
        limit,
        offset
    );
  }

  private InvoiceRecord mapInvoice(ResultSet rs) {
    try {
      return new InvoiceRecord(
          rs.getLong("id"),
          rs.getLong("outlet_id"),
          rs.getLong("sale_id"),
          rs.getString("invoice_number"),
          rs.getInt("invoice_year"),
          rs.getLong("invoice_serial"),
          rs.getTimestamp("issued_at").toInstant(),
          rs.getString("seller_tax_code"),
          rs.getString("seller_name"),
          rs.getString("seller_address"),
          rs.getString("buyer_name"),
          rs.getString("buyer_phone"),
          rs.getLong("subtotal_cents"),
          rs.getLong("vat_cents"),
          rs.getLong("total_cents"),
          rs.getString("total_in_words"),
          rs.getString("payment_method"),
          rs.getString("currency"),
          rs.getString("cqt_status"),
          rs.getString("template_version"),
          rs.getTimestamp("created_at").toInstant()
      );
    } catch (SQLException e) {
      throw new RuntimeException(e);
    }
  }

  private InvoiceLineRecord mapLine(ResultSet rs) {
    try {
      return new InvoiceLineRecord(
          rs.getLong("id"),
          rs.getLong("invoice_id"),
          rs.getInt("line_no"),
          rs.getString("product_code"),
          rs.getString("product_name"),
          rs.getString("unit"),
          rs.getBigDecimal("qty"),
          rs.getLong("unit_price_cents"),
          rs.getLong("discount_cents"),
          rs.getBigDecimal("vat_percent"),
          rs.getLong("vat_cents"),
          rs.getLong("amount_cents")
      );
    } catch (SQLException e) {
      throw new RuntimeException(e);
    }
  }
}
