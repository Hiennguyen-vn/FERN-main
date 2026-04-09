package com.fern.services.procurement.infrastructure;

import com.dorabets.common.repository.BaseRepository;
import com.dorabets.common.spring.web.PagedResult;
import com.dorabets.common.spring.web.QueryConventions;
import com.dorabets.common.middleware.ServiceException;
import com.fern.services.procurement.api.ProcurementDtos;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.Date;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import javax.sql.DataSource;
import org.springframework.stereotype.Repository;

@Repository
public class ProcurementRepository extends BaseRepository {

  private static final Set<String> SUPPLIER_SORT_KEYS = Set.of("name", "supplierCode", "status", "createdAt", "id");
  private static final Set<String> PURCHASE_ORDER_SORT_KEYS = Set.of("orderDate", "expectedTotal", "status", "createdAt", "id");
  private static final Set<String> GOODS_RECEIPT_SORT_KEYS = Set.of("businessDate", "receiptTime", "status", "totalPrice", "id");
  private static final Set<String> SUPPLIER_INVOICE_SORT_KEYS = Set.of("invoiceDate", "dueDate", "status", "totalAmount", "id");
  private static final Set<String> SUPPLIER_PAYMENT_SORT_KEYS = Set.of("paymentTime", "status", "amount", "id");

  private final SnowflakeIdGenerator snowflakeIdGenerator;

  public ProcurementRepository(DataSource dataSource, SnowflakeIdGenerator snowflakeIdGenerator) {
    super(dataSource);
    this.snowflakeIdGenerator = snowflakeIdGenerator;
  }

  public ProcurementDtos.SupplierView createSupplier(
      long supplierId,
      ProcurementDtos.CreateSupplierRequest request
  ) {
    return executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.supplier_procurement (
            id, region_id, supplier_code, name, tax_code, address, phone, email,
            contact_person, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?::supplier_status_enum)
          """
      )) {
        ps.setLong(1, supplierId);
        if (request.regionId() == null) {
          ps.setNull(2, java.sql.Types.BIGINT);
        } else {
          ps.setLong(2, request.regionId());
        }
        ps.setString(3, request.supplierCode().trim());
        ps.setString(4, request.name().trim());
        ps.setString(5, request.taxCode());
        ps.setString(6, request.address());
        ps.setString(7, request.phone());
        ps.setString(8, request.email());
        ps.setString(9, request.contactPerson());
        ps.setString(10, request.status().trim());
        ps.executeUpdate();
      } catch (SQLException ex) {
        if ("23505".equals(ex.getSQLState())) {
          throw ServiceException.conflict("Supplier code already exists: " + request.supplierCode());
        }
        throw ex;
      }
      return findSupplierTransactional(conn, supplierId)
          .orElseThrow(() -> new IllegalStateException("Supplier not found after create"));
    });
  }

  public Optional<ProcurementDtos.SupplierView> findSupplier(long supplierId) {
    return executeInTransaction(conn -> findSupplierTransactional(conn, supplierId));
  }

  public PagedResult<ProcurementDtos.SupplierView> listSuppliers(
      Long regionId,
      String status,
      String q,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    return executeInTransaction(conn -> {
      StringBuilder sql = new StringBuilder(
          """
          SELECT id, region_id, supplier_code, name, tax_code, address, phone, email,
                 contact_person, status, deleted_at, created_at, updated_at,
                 COUNT(*) OVER() AS total_count
          FROM core.supplier_procurement
          WHERE deleted_at IS NULL
          """
      );
      List<Object> params = new ArrayList<>();
      if (regionId != null) {
        sql.append(" AND region_id = ?");
        params.add(regionId);
      }
      if (status != null && !status.isBlank()) {
        sql.append(" AND status = ?::supplier_status_enum");
        params.add(status.trim());
      }
      if (q != null && !q.isBlank()) {
        String pattern = "%" + q + "%";
        sql.append(
            """
             AND (
               supplier_code ILIKE ?
               OR name ILIKE ?
               OR COALESCE(tax_code, '') ILIKE ?
               OR COALESCE(contact_person, '') ILIKE ?
               OR COALESCE(email, '') ILIKE ?
             )
            """
        );
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
      }
      sql.append(" ORDER BY ").append(resolveSupplierSortClause(sortBy, sortDir)).append(" LIMIT ? OFFSET ?");
      params.add(limit);
      params.add(offset);
      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bindParams(ps, params);
        try (ResultSet rs = ps.executeQuery()) {
          List<ProcurementDtos.SupplierView> rows = new ArrayList<>();
          long totalCount = 0;
          while (rs.next()) {
            totalCount = rs.getLong("total_count");
            rows.add(mapSupplier(rs));
          }
          return PagedResult.of(rows, limit, offset, totalCount);
        }
      }
    });
  }

  public ProcurementDtos.SupplierView updateSupplier(
      long supplierId,
      ProcurementDtos.UpdateSupplierRequest request
  ) {
    return executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          UPDATE core.supplier_procurement
          SET region_id = ?,
              name = ?,
              tax_code = ?,
              address = ?,
              phone = ?,
              email = ?,
              contact_person = ?,
              status = ?::supplier_status_enum,
              updated_at = NOW()
          WHERE id = ? AND deleted_at IS NULL
          """
      )) {
        if (request.regionId() == null) {
          ps.setNull(1, java.sql.Types.BIGINT);
        } else {
          ps.setLong(1, request.regionId());
        }
        ps.setString(2, request.name().trim());
        ps.setString(3, request.taxCode());
        ps.setString(4, request.address());
        ps.setString(5, request.phone());
        ps.setString(6, request.email());
        ps.setString(7, request.contactPerson());
        ps.setString(8, request.status().trim());
        ps.setLong(9, supplierId);
        if (ps.executeUpdate() == 0) {
          throw ServiceException.notFound("Supplier not found: " + supplierId);
        }
      }
      return findSupplierTransactional(conn, supplierId)
          .orElseThrow(() -> new IllegalStateException("Supplier not found after update"));
    });
  }

  public ProcurementDtos.PurchaseOrderView createPurchaseOrder(
      long purchaseOrderId,
      ProcurementDtos.CreatePurchaseOrderRequest request,
      Long createdByUserId
  ) {
    return executeInTransaction(conn -> {
      BigDecimal expectedTotal = request.items().stream()
          .map(item -> (item.expectedUnitPrice() == null ? BigDecimal.ZERO : item.expectedUnitPrice())
              .multiply(item.qtyOrdered()))
          .reduce(BigDecimal.ZERO, BigDecimal::add);
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.purchase_order (
            id, supplier_id, outlet_id, currency_code, order_date, expected_delivery_date,
            expected_total, status, note, created_by_user_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
          """
      )) {
        ps.setLong(1, purchaseOrderId);
        ps.setLong(2, request.supplierId());
        ps.setLong(3, request.outletId());
        ps.setString(4, request.currencyCode().trim());
        ps.setDate(5, Date.valueOf(request.orderDate()));
        ps.setDate(6, request.expectedDeliveryDate() == null ? null : Date.valueOf(request.expectedDeliveryDate()));
        ps.setBigDecimal(7, expectedTotal);
        ps.setString(8, request.note());
        if (createdByUserId == null) {
          ps.setNull(9, java.sql.Types.BIGINT);
        } else {
          ps.setLong(9, createdByUserId);
        }
        ps.executeUpdate();
      }
      for (ProcurementDtos.PurchaseOrderItemRequest item : request.items()) {
        try (PreparedStatement ps = conn.prepareStatement(
            """
            INSERT INTO core.purchase_order_item (
              po_id, item_id, uom_code, expected_unit_price, qty_ordered, status, note
            ) VALUES (?, ?, ?, ?, ?, 'open', ?)
            """
        )) {
          ps.setLong(1, purchaseOrderId);
          ps.setLong(2, item.itemId());
          ps.setString(3, item.uomCode().trim());
          ps.setBigDecimal(4, item.expectedUnitPrice());
          ps.setBigDecimal(5, item.qtyOrdered());
          ps.setString(6, item.note());
          ps.executeUpdate();
        }
      }
      return findPurchaseOrderTransactional(conn, purchaseOrderId)
          .orElseThrow(() -> new IllegalStateException("Purchase order not found after create"));
    });
  }

  private String resolveSupplierSortClause(String sortBy, String sortDir) {
    String key = QueryConventions.normalizeSortBy(sortBy, SUPPLIER_SORT_KEYS, "name");
    String direction = QueryConventions.normalizeSortDir(sortDir);
    return switch (key) {
      case "supplierCode" -> "supplier_code " + direction + ", id " + direction;
      case "status" -> "status " + direction + ", name ASC, id ASC";
      case "createdAt" -> "created_at " + direction + ", id " + direction;
      case "id" -> "id " + direction;
      case "name" -> "name " + direction + ", id " + direction;
      default -> throw new IllegalArgumentException("Unsupported supplier sort key");
    };
  }

  private String resolvePurchaseOrderSortClause(String sortBy, String sortDir) {
    String key = QueryConventions.normalizeSortBy(sortBy, PURCHASE_ORDER_SORT_KEYS, "orderDate");
    String direction = QueryConventions.normalizeSortDir(sortDir);
    return switch (key) {
      case "expectedTotal" -> "expected_total " + direction + ", id " + direction;
      case "status" -> "status " + direction + ", order_date DESC, id DESC";
      case "createdAt" -> "created_at " + direction + ", id " + direction;
      case "id" -> "id " + direction;
      case "orderDate" -> "order_date " + direction + ", created_at " + direction + ", id " + direction;
      default -> throw new IllegalArgumentException("Unsupported purchase order sort key");
    };
  }

  private String resolveGoodsReceiptSortClause(String sortBy, String sortDir) {
    String key = QueryConventions.normalizeSortBy(sortBy, GOODS_RECEIPT_SORT_KEYS, "businessDate");
    String direction = QueryConventions.normalizeSortDir(sortDir);
    return switch (key) {
      case "receiptTime" -> "gr.receipt_time " + direction + ", gr.id " + direction;
      case "status" -> "gr.status " + direction + ", gr.business_date DESC, gr.id DESC";
      case "totalPrice" -> "gr.total_price " + direction + ", gr.id " + direction;
      case "id" -> "gr.id " + direction;
      case "businessDate" -> "gr.business_date " + direction + ", gr.receipt_time " + direction + ", gr.id " + direction;
      default -> throw new IllegalArgumentException("Unsupported goods receipt sort key");
    };
  }

  private String resolveSupplierInvoiceSortClause(String sortBy, String sortDir) {
    String key = QueryConventions.normalizeSortBy(sortBy, SUPPLIER_INVOICE_SORT_KEYS, "invoiceDate");
    String direction = QueryConventions.normalizeSortDir(sortDir);
    return switch (key) {
      case "dueDate" -> "si.due_date " + direction + " NULLS LAST, si.id " + direction;
      case "status" -> "si.status " + direction + ", si.invoice_date DESC, si.id DESC";
      case "totalAmount" -> "si.total_amount " + direction + ", si.id " + direction;
      case "id" -> "si.id " + direction;
      case "invoiceDate" -> "si.invoice_date " + direction + ", si.created_at " + direction + ", si.id " + direction;
      default -> throw new IllegalArgumentException("Unsupported supplier invoice sort key");
    };
  }

  private String resolveSupplierPaymentSortClause(String sortBy, String sortDir) {
    String key = QueryConventions.normalizeSortBy(sortBy, SUPPLIER_PAYMENT_SORT_KEYS, "paymentTime");
    String direction = QueryConventions.normalizeSortDir(sortDir);
    return switch (key) {
      case "status" -> "sp.status " + direction + ", sp.payment_time DESC, sp.id DESC";
      case "amount" -> "sp.amount " + direction + ", sp.id " + direction;
      case "id" -> "sp.id " + direction;
      case "paymentTime" -> "sp.payment_time " + direction + ", sp.id " + direction;
      default -> throw new IllegalArgumentException("Unsupported supplier payment sort key");
    };
  }

  public Optional<ProcurementDtos.PurchaseOrderView> findPurchaseOrder(long purchaseOrderId) {
    return executeInTransaction(conn -> findPurchaseOrderTransactional(conn, purchaseOrderId));
  }

  public PagedResult<ProcurementDtos.PurchaseOrderListItemView> listPurchaseOrders(
      Set<Long> outletIds,
      Long supplierId,
      String status,
      LocalDate startDate,
      LocalDate endDate,
      String q,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    if (outletIds != null && outletIds.isEmpty()) {
      return PagedResult.of(List.of(), limit, offset, 0);
    }
    return executeInTransaction(conn -> {
      StringBuilder sql = new StringBuilder(
          """
          SELECT id, supplier_id, outlet_id, currency_code, order_date, expected_delivery_date, expected_total,
                 status, note, created_by_user_id, approved_by_user_id, approved_at, created_at, updated_at,
                 COUNT(*) OVER() AS total_count
          FROM core.purchase_order
          WHERE 1 = 1
          """
      );
      List<Object> params = new ArrayList<>();
      appendInClause(sql, params, "outlet_id", outletIds);
      if (supplierId != null) {
        sql.append(" AND supplier_id = ?");
        params.add(supplierId);
      }
      if (status != null && !status.isBlank()) {
        sql.append(" AND status = ?::po_status_enum");
        params.add(status.trim());
      }
      if (startDate != null) {
        sql.append(" AND order_date >= ?");
        params.add(Date.valueOf(startDate));
      }
      if (endDate != null) {
        sql.append(" AND order_date <= ?");
        params.add(Date.valueOf(endDate));
      }
      if (q != null && !q.isBlank()) {
        String pattern = "%" + q + "%";
        sql.append(
            """
             AND (
               id::text ILIKE ?
               OR supplier_id::text ILIKE ?
               OR status::text ILIKE ?
               OR currency_code ILIKE ?
               OR COALESCE(note, '') ILIKE ?
             )
            """
        );
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
      }
      sql.append(" ORDER BY ").append(resolvePurchaseOrderSortClause(sortBy, sortDir)).append(" LIMIT ? OFFSET ?");
      params.add(limit);
      params.add(offset);
      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bindParams(ps, params);
        try (ResultSet rs = ps.executeQuery()) {
          List<ProcurementDtos.PurchaseOrderListItemView> rows = new ArrayList<>();
          long totalCount = 0;
          while (rs.next()) {
            totalCount = rs.getLong("total_count");
            rows.add(mapPurchaseOrderListItem(rs));
          }
          return PagedResult.of(rows, limit, offset, totalCount);
        }
      }
    });
  }

  public ProcurementDtos.PurchaseOrderView approvePurchaseOrder(long purchaseOrderId, Long approvedByUserId) {
    return executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          UPDATE core.purchase_order
          SET status = 'approved',
              approved_by_user_id = ?,
              approved_at = NOW(),
              updated_at = NOW()
          WHERE id = ?
          """
      )) {
        if (approvedByUserId == null) {
          ps.setNull(1, java.sql.Types.BIGINT);
        } else {
          ps.setLong(1, approvedByUserId);
        }
        ps.setLong(2, purchaseOrderId);
        ps.executeUpdate();
      }
      return findPurchaseOrderTransactional(conn, purchaseOrderId)
          .orElseThrow(() -> new IllegalStateException("Purchase order not found after approval"));
    });
  }

  public ProcurementDtos.GoodsReceiptView createGoodsReceipt(
      long receiptId,
      ProcurementDtos.CreateGoodsReceiptRequest request,
      Long createdByUserId
  ) {
    return executeInTransaction(conn -> {
      Instant now = Instant.now();
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.goods_receipt (
            id, po_id, currency_code, receipt_time, business_date, status,
            note, total_price, supplier_lot_number, created_by_user_id
          ) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)
          """
      )) {
        ps.setLong(1, receiptId);
        ps.setLong(2, request.poId());
        ps.setString(3, request.currencyCode().trim());
        ps.setTimestamp(4, Timestamp.from(now));
        ps.setDate(5, Date.valueOf(request.businessDate()));
        ps.setString(6, request.note());
        ps.setBigDecimal(7, request.totalPrice());
        ps.setString(8, request.supplierLotNumber());
        if (createdByUserId == null) {
          ps.setNull(9, java.sql.Types.BIGINT);
        } else {
          ps.setLong(9, createdByUserId);
        }
        ps.executeUpdate();
      }
      for (ProcurementDtos.GoodsReceiptItemRequest item : request.items()) {
        long itemRowId = insertGoodsReceiptItem(conn, receiptId, request.poId(), item);
        if (itemRowId <= 0) {
          throw new IllegalStateException("Failed to create goods receipt item");
        }
      }
      return findGoodsReceiptTransactional(conn, receiptId)
          .orElseThrow(() -> new IllegalStateException("Goods receipt not found after create"));
    });
  }

  public Optional<ProcurementDtos.GoodsReceiptView> findGoodsReceipt(long receiptId) {
    return executeInTransaction(conn -> findGoodsReceiptTransactional(conn, receiptId));
  }

  public PagedResult<ProcurementDtos.GoodsReceiptListItemView> listGoodsReceipts(
      Set<Long> outletIds,
      Long poId,
      String status,
      LocalDate startDate,
      LocalDate endDate,
      String q,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    if (outletIds != null && outletIds.isEmpty()) {
      return PagedResult.of(List.of(), limit, offset, 0);
    }
    return executeInTransaction(conn -> {
      StringBuilder sql = new StringBuilder(
          """
          SELECT gr.id, gr.po_id, po.outlet_id, gr.currency_code, gr.receipt_time, gr.business_date, gr.status,
                 gr.total_price, gr.supplier_lot_number, gr.created_by_user_id, gr.approved_by_user_id,
                 gr.approved_at, gr.created_at, gr.updated_at, COUNT(*) OVER() AS total_count
          FROM core.goods_receipt gr
          JOIN core.purchase_order po ON po.id = gr.po_id
          WHERE 1 = 1
          """
      );
      List<Object> params = new ArrayList<>();
      appendInClause(sql, params, "po.outlet_id", outletIds);
      if (poId != null) {
        sql.append(" AND gr.po_id = ?");
        params.add(poId);
      }
      if (status != null && !status.isBlank()) {
        sql.append(" AND gr.status = ?::gr_status_enum");
        params.add(status.trim());
      }
      if (startDate != null) {
        sql.append(" AND gr.business_date >= ?");
        params.add(Date.valueOf(startDate));
      }
      if (endDate != null) {
        sql.append(" AND gr.business_date <= ?");
        params.add(Date.valueOf(endDate));
      }
      if (q != null && !q.isBlank()) {
        String pattern = "%" + q + "%";
        sql.append(
            """
             AND (
               gr.id::text ILIKE ?
               OR gr.po_id::text ILIKE ?
               OR gr.status::text ILIKE ?
               OR gr.currency_code ILIKE ?
               OR COALESCE(gr.supplier_lot_number, '') ILIKE ?
               OR COALESCE(gr.note, '') ILIKE ?
             )
            """
        );
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
      }
      sql.append(" ORDER BY ").append(resolveGoodsReceiptSortClause(sortBy, sortDir)).append(" LIMIT ? OFFSET ?");
      params.add(limit);
      params.add(offset);
      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bindParams(ps, params);
        try (ResultSet rs = ps.executeQuery()) {
          List<ProcurementDtos.GoodsReceiptListItemView> rows = new ArrayList<>();
          long totalCount = 0;
          while (rs.next()) {
            totalCount = rs.getLong("total_count");
            rows.add(mapGoodsReceiptListItem(rs));
          }
          return PagedResult.of(rows, limit, offset, totalCount);
        }
      }
    });
  }

  public ProcurementDtos.GoodsReceiptView approveGoodsReceipt(long receiptId, Long approvedByUserId) {
    return executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          UPDATE core.goods_receipt
          SET status = 'received',
              approved_by_user_id = ?,
              approved_at = NOW(),
              updated_at = NOW()
          WHERE id = ?
          """
      )) {
        if (approvedByUserId == null) {
          ps.setNull(1, java.sql.Types.BIGINT);
        } else {
          ps.setLong(1, approvedByUserId);
        }
        ps.setLong(2, receiptId);
        ps.executeUpdate();
      }
      return findGoodsReceiptTransactional(conn, receiptId)
          .orElseThrow(() -> new IllegalStateException("Goods receipt not found after approval"));
    });
  }

  public ProcurementDtos.GoodsReceiptView postGoodsReceipt(long receiptId) {
    return executeInTransaction(conn -> {
      ProcurementDtos.GoodsReceiptView receipt = findGoodsReceiptTransactional(conn, receiptId)
          .orElseThrow(() -> new IllegalStateException("Goods receipt not found: " + receiptId));
      try (PreparedStatement ps = conn.prepareStatement(
          "UPDATE core.goods_receipt SET status = 'posted', updated_at = NOW() WHERE id = ?"
      )) {
        ps.setLong(1, receiptId);
        ps.executeUpdate();
      }
      for (ProcurementDtos.GoodsReceiptItemView item : receipt.items()) {
        updatePurchaseOrderReceiptProgress(conn, receipt.poId(), item.itemId(), item.qtyReceived());
      }
      return findGoodsReceiptTransactional(conn, receiptId)
          .orElseThrow(() -> new IllegalStateException("Goods receipt not found after posting"));
    });
  }

  public ProcurementDtos.SupplierInvoiceView createSupplierInvoice(
      long invoiceId,
      ProcurementDtos.CreateSupplierInvoiceRequest request,
      Long createdByUserId
  ) {
    return executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.supplier_invoice (
            id, invoice_number, supplier_id, currency_code, invoice_date, due_date, subtotal,
            tax_amount, total_amount, status, note, created_by_user_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
          """
      )) {
        ps.setLong(1, invoiceId);
        ps.setString(2, request.invoiceNumber().trim());
        ps.setLong(3, request.supplierId());
        ps.setString(4, request.currencyCode().trim());
        ps.setDate(5, Date.valueOf(request.invoiceDate()));
        ps.setDate(6, request.dueDate() == null ? null : Date.valueOf(request.dueDate()));
        ps.setBigDecimal(7, request.subtotal());
        ps.setBigDecimal(8, request.taxAmount());
        ps.setBigDecimal(9, request.totalAmount());
        ps.setString(10, request.note());
        if (createdByUserId == null) {
          ps.setNull(11, java.sql.Types.BIGINT);
        } else {
          ps.setLong(11, createdByUserId);
        }
        ps.executeUpdate();
      }
      int lineNumber = 1;
      for (ProcurementDtos.SupplierInvoiceItemRequest item : request.items()) {
        try (PreparedStatement ps = conn.prepareStatement(
            """
            INSERT INTO core.supplier_invoice_item (
              invoice_id, line_number, line_type, goods_receipt_item_id, description,
              qty_invoiced, unit_price, tax_percent, tax_amount, line_total, note
            ) VALUES (?, ?, ?::supplier_invoice_line_type_enum, ?, ?, ?, ?, ?, ?, ?, ?)
            """
        )) {
          ps.setLong(1, invoiceId);
          ps.setInt(2, lineNumber++);
          ps.setString(3, item.lineType().trim());
          if (item.goodsReceiptItemId() == null) {
            ps.setNull(4, java.sql.Types.BIGINT);
          } else {
            ps.setLong(4, item.goodsReceiptItemId());
          }
          ps.setString(5, item.description());
          ps.setBigDecimal(6, item.qtyInvoiced());
          ps.setBigDecimal(7, item.unitPrice());
          ps.setBigDecimal(8, item.taxPercent() == null ? BigDecimal.ZERO : item.taxPercent());
          ps.setBigDecimal(9, item.taxAmount());
          ps.setBigDecimal(10, item.lineTotal());
          ps.setString(11, item.note());
          ps.executeUpdate();
        }
      }
      for (Long receiptId : request.linkedReceiptIds()) {
        try (PreparedStatement ps = conn.prepareStatement(
            "INSERT INTO core.supplier_invoice_receipt (invoice_id, receipt_id) VALUES (?, ?)"
        )) {
          ps.setLong(1, invoiceId);
          ps.setLong(2, receiptId);
          ps.executeUpdate();
        }
      }
      return findSupplierInvoiceTransactional(conn, invoiceId)
          .orElseThrow(() -> new IllegalStateException("Supplier invoice not found after create"));
    });
  }

  public Optional<ProcurementDtos.SupplierInvoiceView> findSupplierInvoice(long invoiceId) {
    return executeInTransaction(conn -> findSupplierInvoiceTransactional(conn, invoiceId));
  }

  public PagedResult<ProcurementDtos.SupplierInvoiceListItemView> listSupplierInvoices(
      Set<Long> outletIds,
      Long supplierId,
      String status,
      LocalDate invoiceDateFrom,
      LocalDate invoiceDateTo,
      LocalDate dueDateTo,
      String q,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    if (outletIds != null && outletIds.isEmpty()) {
      return PagedResult.of(List.of(), limit, offset, 0);
    }
    return executeInTransaction(conn -> {
      StringBuilder sql = new StringBuilder(
          """
          SELECT si.id, si.invoice_number, si.supplier_id, scope.outlet_id, si.currency_code, si.invoice_date,
                 si.due_date, si.total_amount, si.status, si.note, si.created_by_user_id, si.approved_by_user_id,
                 si.approved_at, si.created_at, si.updated_at, COUNT(*) OVER() AS total_count
          FROM core.supplier_invoice si
          JOIN LATERAL (
            SELECT po.outlet_id
            FROM core.supplier_invoice_receipt sir
            JOIN core.goods_receipt gr ON gr.id = sir.receipt_id
            JOIN core.purchase_order po ON po.id = gr.po_id
            WHERE sir.invoice_id = si.id
            ORDER BY sir.receipt_id
            LIMIT 1
          ) scope ON TRUE
          WHERE 1 = 1
          """
      );
      List<Object> params = new ArrayList<>();
      appendInClause(sql, params, "scope.outlet_id", outletIds);
      if (supplierId != null) {
        sql.append(" AND si.supplier_id = ?");
        params.add(supplierId);
      }
      if (status != null && !status.isBlank()) {
        sql.append(" AND si.status = ?::supplier_invoice_status_enum");
        params.add(status.trim());
      }
      if (invoiceDateFrom != null) {
        sql.append(" AND si.invoice_date >= ?");
        params.add(Date.valueOf(invoiceDateFrom));
      }
      if (invoiceDateTo != null) {
        sql.append(" AND si.invoice_date <= ?");
        params.add(Date.valueOf(invoiceDateTo));
      }
      if (dueDateTo != null) {
        sql.append(" AND si.due_date <= ?");
        params.add(Date.valueOf(dueDateTo));
      }
      if (q != null && !q.isBlank()) {
        String pattern = "%" + q + "%";
        sql.append(
            """
             AND (
               si.id::text ILIKE ?
               OR si.invoice_number ILIKE ?
               OR si.supplier_id::text ILIKE ?
               OR si.status::text ILIKE ?
               OR si.currency_code ILIKE ?
               OR COALESCE(si.note, '') ILIKE ?
             )
            """
        );
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
      }
      sql.append(" ORDER BY ").append(resolveSupplierInvoiceSortClause(sortBy, sortDir)).append(" LIMIT ? OFFSET ?");
      params.add(limit);
      params.add(offset);
      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bindParams(ps, params);
        try (ResultSet rs = ps.executeQuery()) {
          List<ProcurementDtos.SupplierInvoiceListItemView> rows = new ArrayList<>();
          long totalCount = 0;
          while (rs.next()) {
            totalCount = rs.getLong("total_count");
            rows.add(mapSupplierInvoiceListItem(rs));
          }
          return PagedResult.of(rows, limit, offset, totalCount);
        }
      }
    });
  }

  public ProcurementDtos.SupplierInvoiceView approveSupplierInvoice(long invoiceId, Long approvedByUserId) {
    return executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          UPDATE core.supplier_invoice
          SET status = 'approved',
              approved_by_user_id = ?,
              approved_at = NOW(),
              updated_at = NOW()
          WHERE id = ?
          """
      )) {
        if (approvedByUserId == null) {
          ps.setNull(1, java.sql.Types.BIGINT);
        } else {
          ps.setLong(1, approvedByUserId);
        }
        ps.setLong(2, invoiceId);
        ps.executeUpdate();
      }
      return findSupplierInvoiceTransactional(conn, invoiceId)
          .orElseThrow(() -> new IllegalStateException("Supplier invoice not found after approval"));
    });
  }

  public ProcurementDtos.SupplierPaymentView createSupplierPayment(
      long paymentId,
      ProcurementDtos.CreateSupplierPaymentRequest request,
      Long createdByUserId
  ) {
    return executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.supplier_payment (
            id, supplier_id, currency_code, payment_method, amount, status,
            payment_time, transaction_ref, note, created_by_user_id
          ) VALUES (?, ?, ?, ?::payment_method_enum, ?, 'pending', ?, ?, ?, ?)
          """
      )) {
        ps.setLong(1, paymentId);
        ps.setLong(2, request.supplierId());
        ps.setString(3, request.currencyCode().trim());
        ps.setString(4, request.paymentMethod().trim());
        ps.setBigDecimal(5, request.amount());
        ps.setTimestamp(6, Timestamp.from(request.paymentTime()));
        ps.setString(7, request.transactionRef());
        ps.setString(8, request.note());
        if (createdByUserId == null) {
          ps.setNull(9, java.sql.Types.BIGINT);
        } else {
          ps.setLong(9, createdByUserId);
        }
        ps.executeUpdate();
      }
      BigDecimal totalAllocated = BigDecimal.ZERO;
      for (ProcurementDtos.PaymentAllocationRequest allocation : request.allocations()) {
        validatePaymentAllocation(conn, request.supplierId(), request.currencyCode(), allocation);
        totalAllocated = totalAllocated.add(allocation.allocatedAmount());
        try (PreparedStatement ps = conn.prepareStatement(
            """
            INSERT INTO core.supplier_payment_allocation (
              payment_id, invoice_id, allocated_amount, note
            ) VALUES (?, ?, ?, ?)
            """
        )) {
          ps.setLong(1, paymentId);
          ps.setLong(2, allocation.invoiceId());
          ps.setBigDecimal(3, allocation.allocatedAmount());
          ps.setString(4, allocation.note());
          ps.executeUpdate();
        }
      }
      if (totalAllocated.compareTo(request.amount()) > 0) {
        throw ServiceException.conflict("Allocated amount exceeds payment amount");
      }
      return findSupplierPaymentTransactional(conn, paymentId)
          .orElseThrow(() -> new IllegalStateException("Supplier payment not found after create"));
    });
  }

  public Optional<ProcurementDtos.SupplierPaymentView> findSupplierPayment(long paymentId) {
    return executeInTransaction(conn -> findSupplierPaymentTransactional(conn, paymentId));
  }

  public PagedResult<ProcurementDtos.SupplierPaymentListItemView> listSupplierPayments(
      Set<Long> outletIds,
      Long supplierId,
      String status,
      Instant startTime,
      Instant endTime,
      String q,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    if (outletIds != null && outletIds.isEmpty()) {
      return PagedResult.of(List.of(), limit, offset, 0);
    }
    return executeInTransaction(conn -> {
      StringBuilder sql = new StringBuilder(
          """
          SELECT sp.id, sp.supplier_id, scope.outlet_id, sp.currency_code, sp.payment_method, sp.amount,
                 sp.status, sp.payment_time, sp.transaction_ref, sp.note, sp.created_by_user_id,
                 sp.created_at, sp.updated_at, COUNT(*) OVER() AS total_count
          FROM core.supplier_payment sp
          JOIN LATERAL (
            SELECT po.outlet_id
            FROM core.supplier_payment_allocation spa
            JOIN core.supplier_invoice si ON si.id = spa.invoice_id
            JOIN core.supplier_invoice_receipt sir ON sir.invoice_id = si.id
            JOIN core.goods_receipt gr ON gr.id = sir.receipt_id
            JOIN core.purchase_order po ON po.id = gr.po_id
            WHERE spa.payment_id = sp.id
            ORDER BY spa.invoice_id, sir.receipt_id
            LIMIT 1
          ) scope ON TRUE
          WHERE 1 = 1
          """
      );
      List<Object> params = new ArrayList<>();
      appendInClause(sql, params, "scope.outlet_id", outletIds);
      if (supplierId != null) {
        sql.append(" AND sp.supplier_id = ?");
        params.add(supplierId);
      }
      if (status != null && !status.isBlank()) {
        sql.append(" AND sp.status = ?::supplier_payment_status_enum");
        params.add(status.trim());
      }
      if (startTime != null) {
        sql.append(" AND sp.payment_time >= ?");
        params.add(Timestamp.from(startTime));
      }
      if (endTime != null) {
        sql.append(" AND sp.payment_time <= ?");
        params.add(Timestamp.from(endTime));
      }
      if (q != null && !q.isBlank()) {
        String pattern = "%" + q + "%";
        sql.append(
            """
             AND (
               sp.id::text ILIKE ?
               OR sp.supplier_id::text ILIKE ?
               OR sp.status::text ILIKE ?
               OR sp.currency_code ILIKE ?
               OR sp.payment_method::text ILIKE ?
               OR COALESCE(sp.transaction_ref, '') ILIKE ?
               OR COALESCE(sp.note, '') ILIKE ?
             )
            """
        );
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
      }
      sql.append(" ORDER BY ").append(resolveSupplierPaymentSortClause(sortBy, sortDir)).append(" LIMIT ? OFFSET ?");
      params.add(limit);
      params.add(offset);
      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bindParams(ps, params);
        try (ResultSet rs = ps.executeQuery()) {
          List<ProcurementDtos.SupplierPaymentListItemView> rows = new ArrayList<>();
          long totalCount = 0;
          while (rs.next()) {
            totalCount = rs.getLong("total_count");
            rows.add(mapSupplierPaymentListItem(rs));
          }
          return PagedResult.of(rows, limit, offset, totalCount);
        }
      }
    });
  }

  public ProcurementDtos.SupplierPaymentView updateSupplierPaymentStatus(long paymentId, String status) {
    return executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          UPDATE core.supplier_payment
          SET status = ?::supplier_payment_status_enum,
              updated_at = NOW()
          WHERE id = ?
          """
      )) {
        ps.setString(1, status);
        ps.setLong(2, paymentId);
        if (ps.executeUpdate() == 0) {
          throw ServiceException.notFound("Supplier payment not found: " + paymentId);
        }
      }
      return findSupplierPaymentTransactional(conn, paymentId)
          .orElseThrow(() -> new IllegalStateException("Supplier payment not found after status update"));
    });
  }

  private Optional<ProcurementDtos.SupplierView> findSupplierTransactional(Connection conn, long supplierId)
      throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT id, region_id, supplier_code, name, tax_code, address, phone, email,
               contact_person, status, deleted_at, created_at, updated_at
        FROM core.supplier_procurement
        WHERE id = ?
        """
    )) {
      ps.setLong(1, supplierId);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) {
          return Optional.empty();
        }
        return Optional.of(mapSupplier(rs));
      }
    }
  }

  private Optional<ProcurementDtos.PurchaseOrderView> findPurchaseOrderTransactional(Connection conn, long purchaseOrderId)
      throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT id, supplier_id, outlet_id, currency_code, order_date, expected_delivery_date, expected_total,
               status, note, created_by_user_id, approved_by_user_id, approved_at, created_at, updated_at
        FROM core.purchase_order
        WHERE id = ?
        """
    )) {
      ps.setLong(1, purchaseOrderId);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) {
          return Optional.empty();
        }
        List<ProcurementDtos.PurchaseOrderItemView> items = loadPurchaseOrderItems(conn, purchaseOrderId);
        return Optional.of(new ProcurementDtos.PurchaseOrderView(
            rs.getLong("id"),
            rs.getLong("supplier_id"),
            rs.getLong("outlet_id"),
            rs.getString("currency_code"),
            rs.getDate("order_date").toLocalDate(),
            toLocalDate(rs.getDate("expected_delivery_date")),
            rs.getBigDecimal("expected_total"),
            rs.getString("status"),
            rs.getString("note"),
            rs.getObject("created_by_user_id", Long.class),
            rs.getObject("approved_by_user_id", Long.class),
            toInstant(rs.getTimestamp("approved_at")),
            rs.getTimestamp("created_at").toInstant(),
            rs.getTimestamp("updated_at").toInstant(),
            items
        ));
      }
    }
  }

  private List<ProcurementDtos.PurchaseOrderItemView> loadPurchaseOrderItems(Connection conn, long purchaseOrderId)
      throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT item_id, uom_code, expected_unit_price, qty_ordered, qty_received, status, note
        FROM core.purchase_order_item
        WHERE po_id = ?
        ORDER BY item_id
        """
    )) {
      ps.setLong(1, purchaseOrderId);
      try (ResultSet rs = ps.executeQuery()) {
        List<ProcurementDtos.PurchaseOrderItemView> items = new ArrayList<>();
        while (rs.next()) {
          items.add(new ProcurementDtos.PurchaseOrderItemView(
              rs.getLong("item_id"),
              rs.getString("uom_code"),
              rs.getBigDecimal("expected_unit_price"),
              rs.getBigDecimal("qty_ordered"),
              rs.getBigDecimal("qty_received"),
              rs.getString("status"),
              rs.getString("note")
          ));
        }
        return items;
      }
    }
  }

  private long insertGoodsReceiptItem(Connection conn, long receiptId, long poId, ProcurementDtos.GoodsReceiptItemRequest item)
      throws Exception {
    long rowId = snowflakeIdGenerator.generateId();
    try (PreparedStatement ps = conn.prepareStatement(
        """
        INSERT INTO core.goods_receipt_item (
          id, receipt_id, po_id, item_id, uom_code, qty_received, unit_cost,
          line_total, manufacture_date, expiry_date, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
    )) {
      ps.setLong(1, rowId);
      ps.setLong(2, receiptId);
      ps.setLong(3, poId);
      ps.setLong(4, item.itemId());
      ps.setString(5, item.uomCode().trim());
      ps.setBigDecimal(6, item.qtyReceived());
      ps.setBigDecimal(7, item.unitCost());
      ps.setBigDecimal(8, item.qtyReceived().multiply(item.unitCost()));
      ps.setDate(9, item.manufactureDate() == null ? null : Date.valueOf(item.manufactureDate()));
      ps.setDate(10, item.expiryDate() == null ? null : Date.valueOf(item.expiryDate()));
      ps.setString(11, item.note());
      ps.executeUpdate();
      return rowId;
    }
  }

  private Optional<ProcurementDtos.GoodsReceiptView> findGoodsReceiptTransactional(Connection conn, long receiptId)
      throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT id, po_id, currency_code, receipt_time, business_date, status, note, total_price,
               supplier_lot_number, created_by_user_id, approved_by_user_id, approved_at, created_at, updated_at
        FROM core.goods_receipt
        WHERE id = ?
        """
    )) {
      ps.setLong(1, receiptId);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) {
          return Optional.empty();
        }
        List<ProcurementDtos.GoodsReceiptItemView> items = loadGoodsReceiptItems(conn, receiptId);
        return Optional.of(new ProcurementDtos.GoodsReceiptView(
            rs.getLong("id"),
            rs.getLong("po_id"),
            rs.getString("currency_code"),
            rs.getTimestamp("receipt_time").toInstant(),
            rs.getDate("business_date").toLocalDate(),
            rs.getString("status"),
            rs.getString("note"),
            rs.getBigDecimal("total_price"),
            rs.getString("supplier_lot_number"),
            rs.getObject("created_by_user_id", Long.class),
            rs.getObject("approved_by_user_id", Long.class),
            toInstant(rs.getTimestamp("approved_at")),
            rs.getTimestamp("created_at").toInstant(),
            rs.getTimestamp("updated_at").toInstant(),
            items
        ));
      }
    }
  }

  private List<ProcurementDtos.GoodsReceiptItemView> loadGoodsReceiptItems(Connection conn, long receiptId)
      throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT id, item_id, uom_code, qty_received, unit_cost, line_total, manufacture_date, expiry_date, note
        FROM core.goods_receipt_item
        WHERE receipt_id = ?
        ORDER BY item_id
        """
    )) {
      ps.setLong(1, receiptId);
      try (ResultSet rs = ps.executeQuery()) {
        List<ProcurementDtos.GoodsReceiptItemView> items = new ArrayList<>();
        while (rs.next()) {
          items.add(new ProcurementDtos.GoodsReceiptItemView(
              rs.getLong("id"),
              rs.getLong("item_id"),
              rs.getString("uom_code"),
              rs.getBigDecimal("qty_received"),
              rs.getBigDecimal("unit_cost"),
              rs.getBigDecimal("line_total"),
              toLocalDate(rs.getDate("manufacture_date")),
              toLocalDate(rs.getDate("expiry_date")),
              rs.getString("note")
          ));
        }
        return items;
      }
    }
  }

  private Optional<ProcurementDtos.SupplierInvoiceView> findSupplierInvoiceTransactional(Connection conn, long invoiceId)
      throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT id, invoice_number, supplier_id, currency_code, invoice_date, due_date, subtotal,
               tax_amount, total_amount, status, note, created_by_user_id, approved_by_user_id,
               approved_at, created_at, updated_at
        FROM core.supplier_invoice
        WHERE id = ?
        """
    )) {
      ps.setLong(1, invoiceId);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) {
          return Optional.empty();
        }
        return Optional.of(new ProcurementDtos.SupplierInvoiceView(
            rs.getLong("id"),
            rs.getString("invoice_number"),
            rs.getLong("supplier_id"),
            rs.getString("currency_code"),
            rs.getDate("invoice_date").toLocalDate(),
            toLocalDate(rs.getDate("due_date")),
            rs.getBigDecimal("subtotal"),
            rs.getBigDecimal("tax_amount"),
            rs.getBigDecimal("total_amount"),
            rs.getString("status"),
            rs.getString("note"),
            rs.getObject("created_by_user_id", Long.class),
            rs.getObject("approved_by_user_id", Long.class),
            toInstant(rs.getTimestamp("approved_at")),
            rs.getTimestamp("created_at").toInstant(),
            rs.getTimestamp("updated_at").toInstant(),
            loadInvoiceReceiptIds(conn, invoiceId),
            loadInvoiceItems(conn, invoiceId)
        ));
      }
    }
  }

  private List<Long> loadInvoiceReceiptIds(Connection conn, long invoiceId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        "SELECT receipt_id FROM core.supplier_invoice_receipt WHERE invoice_id = ? ORDER BY receipt_id"
    )) {
      ps.setLong(1, invoiceId);
      try (ResultSet rs = ps.executeQuery()) {
        List<Long> receiptIds = new ArrayList<>();
        while (rs.next()) {
          receiptIds.add(rs.getLong("receipt_id"));
        }
        return receiptIds;
      }
    }
  }

  private List<ProcurementDtos.SupplierInvoiceItemView> loadInvoiceItems(Connection conn, long invoiceId)
      throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT line_number, line_type, goods_receipt_item_id, description, qty_invoiced, unit_price,
               tax_percent, tax_amount, line_total, note
        FROM core.supplier_invoice_item
        WHERE invoice_id = ?
        ORDER BY line_number
        """
    )) {
      ps.setLong(1, invoiceId);
      try (ResultSet rs = ps.executeQuery()) {
        List<ProcurementDtos.SupplierInvoiceItemView> items = new ArrayList<>();
        while (rs.next()) {
          items.add(new ProcurementDtos.SupplierInvoiceItemView(
              rs.getInt("line_number"),
              rs.getString("line_type"),
              rs.getObject("goods_receipt_item_id", Long.class),
              rs.getString("description"),
              rs.getBigDecimal("qty_invoiced"),
              rs.getBigDecimal("unit_price"),
              rs.getBigDecimal("tax_percent"),
              rs.getBigDecimal("tax_amount"),
              rs.getBigDecimal("line_total"),
              rs.getString("note")
          ));
        }
        return items;
      }
    }
  }

  private Optional<ProcurementDtos.SupplierPaymentView> findSupplierPaymentTransactional(Connection conn, long paymentId)
      throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT id, supplier_id, currency_code, payment_method, amount, status, payment_time,
               transaction_ref, note, created_by_user_id, created_at, updated_at
        FROM core.supplier_payment
        WHERE id = ?
        """
    )) {
      ps.setLong(1, paymentId);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) {
          return Optional.empty();
        }
        return Optional.of(new ProcurementDtos.SupplierPaymentView(
            Long.toString(rs.getLong("id")),
            rs.getLong("supplier_id"),
            rs.getString("currency_code"),
            rs.getString("payment_method"),
            rs.getBigDecimal("amount"),
            rs.getString("status"),
            rs.getTimestamp("payment_time").toInstant(),
            rs.getString("transaction_ref"),
            rs.getString("note"),
            rs.getObject("created_by_user_id", Long.class),
            rs.getTimestamp("created_at").toInstant(),
            rs.getTimestamp("updated_at").toInstant(),
            loadPaymentAllocations(conn, paymentId)
        ));
      }
    }
  }

  private List<ProcurementDtos.SupplierPaymentAllocationView> loadPaymentAllocations(Connection conn, long paymentId)
      throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT invoice_id, allocated_amount, note
        FROM core.supplier_payment_allocation
        WHERE payment_id = ?
        ORDER BY invoice_id
        """
    )) {
      ps.setLong(1, paymentId);
      try (ResultSet rs = ps.executeQuery()) {
        List<ProcurementDtos.SupplierPaymentAllocationView> allocations = new ArrayList<>();
        while (rs.next()) {
          allocations.add(new ProcurementDtos.SupplierPaymentAllocationView(
              rs.getLong("invoice_id"),
              rs.getBigDecimal("allocated_amount"),
              rs.getString("note")
          ));
        }
        return allocations;
      }
    }
  }

  private void updatePurchaseOrderReceiptProgress(Connection conn, long poId, long itemId, BigDecimal qtyReceived)
      throws Exception {
    BigDecimal updatedQtyReceived;
    try (PreparedStatement ps = conn.prepareStatement(
        """
        UPDATE core.purchase_order_item
        SET qty_received = qty_received + ?,
            status = CASE
              WHEN qty_received + ? >= qty_ordered THEN 'completed'::po_item_status_enum
              WHEN qty_received + ? > 0 THEN 'partially_received'::po_item_status_enum
              ELSE status
            END,
            updated_at = NOW()
        WHERE po_id = ? AND item_id = ?
        RETURNING qty_received
        """
    )) {
      ps.setBigDecimal(1, qtyReceived);
      ps.setBigDecimal(2, qtyReceived);
      ps.setBigDecimal(3, qtyReceived);
      ps.setLong(4, poId);
      ps.setLong(5, itemId);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) {
          throw ServiceException.notFound("Purchase order item not found for po=" + poId + ", item=" + itemId);
        }
        updatedQtyReceived = rs.getBigDecimal(1);
      }
    }
    try (PreparedStatement ps = conn.prepareStatement(
        """
        UPDATE core.purchase_order
        SET status = CASE
          WHEN EXISTS (
            SELECT 1 FROM core.purchase_order_item
            WHERE po_id = ? AND status IN ('open', 'partially_received')
          ) THEN 'partially_received'::po_status_enum
          ELSE 'completed'::po_status_enum
        END,
        updated_at = NOW()
        WHERE id = ?
        """
    )) {
      ps.setLong(1, poId);
      ps.setLong(2, poId);
      ps.executeUpdate();
    }
  }

  private void validatePaymentAllocation(
      Connection conn,
      long supplierId,
      String currencyCode,
      ProcurementDtos.PaymentAllocationRequest allocation
  ) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT supplier_id, currency_code, total_amount
        FROM core.supplier_invoice
        WHERE id = ?
        """
    )) {
      ps.setLong(1, allocation.invoiceId());
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) {
          throw ServiceException.notFound("Supplier invoice not found: " + allocation.invoiceId());
        }
        if (rs.getLong("supplier_id") != supplierId) {
          throw ServiceException.conflict("Payment supplier does not match invoice supplier");
        }
        if (!currencyCode.equalsIgnoreCase(rs.getString("currency_code"))) {
          throw ServiceException.conflict("Payment currency does not match invoice currency");
        }
        BigDecimal invoiceTotal = rs.getBigDecimal("total_amount");
        BigDecimal alreadyAllocated = loadInvoiceAllocatedAmount(conn, allocation.invoiceId());
        if (alreadyAllocated.add(allocation.allocatedAmount()).compareTo(invoiceTotal) > 0) {
          throw ServiceException.conflict("Payment allocation exceeds invoice total for invoice " + allocation.invoiceId());
        }
      }
    }
  }

  private BigDecimal loadInvoiceAllocatedAmount(Connection conn, long invoiceId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT COALESCE(SUM(spa.allocated_amount), 0)
        FROM core.supplier_payment_allocation spa
        JOIN core.supplier_payment sp ON sp.id = spa.payment_id
        WHERE spa.invoice_id = ?
          AND sp.status <> 'cancelled'
        """
    )) {
      ps.setLong(1, invoiceId);
      try (ResultSet rs = ps.executeQuery()) {
        rs.next();
        return rs.getBigDecimal(1);
      }
    }
  }

  private ProcurementDtos.SupplierView mapSupplier(ResultSet rs) throws SQLException {
    return new ProcurementDtos.SupplierView(
        rs.getLong("id"),
        rs.getObject("region_id", Long.class),
        rs.getString("supplier_code"),
        rs.getString("name"),
        rs.getString("tax_code"),
        rs.getString("address"),
        rs.getString("phone"),
        rs.getString("email"),
        rs.getString("contact_person"),
        rs.getString("status"),
        toInstant(rs.getTimestamp("deleted_at")),
        rs.getTimestamp("created_at").toInstant(),
        rs.getTimestamp("updated_at").toInstant()
    );
  }

  private ProcurementDtos.PurchaseOrderListItemView mapPurchaseOrderListItem(ResultSet rs) throws SQLException {
    return new ProcurementDtos.PurchaseOrderListItemView(
        rs.getLong("id"),
        rs.getLong("supplier_id"),
        rs.getLong("outlet_id"),
        rs.getString("currency_code"),
        rs.getDate("order_date").toLocalDate(),
        toLocalDate(rs.getDate("expected_delivery_date")),
        rs.getBigDecimal("expected_total"),
        rs.getString("status"),
        rs.getString("note"),
        rs.getObject("created_by_user_id", Long.class),
        rs.getObject("approved_by_user_id", Long.class),
        toInstant(rs.getTimestamp("approved_at")),
        rs.getTimestamp("created_at").toInstant(),
        rs.getTimestamp("updated_at").toInstant()
    );
  }

  private ProcurementDtos.GoodsReceiptListItemView mapGoodsReceiptListItem(ResultSet rs) throws SQLException {
    return new ProcurementDtos.GoodsReceiptListItemView(
        rs.getLong("id"),
        rs.getLong("po_id"),
        rs.getLong("outlet_id"),
        rs.getString("currency_code"),
        rs.getTimestamp("receipt_time").toInstant(),
        rs.getDate("business_date").toLocalDate(),
        rs.getString("status"),
        rs.getBigDecimal("total_price"),
        rs.getString("supplier_lot_number"),
        rs.getObject("created_by_user_id", Long.class),
        rs.getObject("approved_by_user_id", Long.class),
        toInstant(rs.getTimestamp("approved_at")),
        rs.getTimestamp("created_at").toInstant(),
        rs.getTimestamp("updated_at").toInstant()
    );
  }

  private ProcurementDtos.SupplierInvoiceListItemView mapSupplierInvoiceListItem(ResultSet rs) throws SQLException {
    return new ProcurementDtos.SupplierInvoiceListItemView(
        rs.getLong("id"),
        rs.getString("invoice_number"),
        rs.getLong("supplier_id"),
        rs.getLong("outlet_id"),
        rs.getString("currency_code"),
        rs.getDate("invoice_date").toLocalDate(),
        toLocalDate(rs.getDate("due_date")),
        rs.getBigDecimal("total_amount"),
        rs.getString("status"),
        rs.getString("note"),
        rs.getObject("created_by_user_id", Long.class),
        rs.getObject("approved_by_user_id", Long.class),
        toInstant(rs.getTimestamp("approved_at")),
        rs.getTimestamp("created_at").toInstant(),
        rs.getTimestamp("updated_at").toInstant()
    );
  }

  private ProcurementDtos.SupplierPaymentListItemView mapSupplierPaymentListItem(ResultSet rs) throws SQLException {
    return new ProcurementDtos.SupplierPaymentListItemView(
        Long.toString(rs.getLong("id")),
        rs.getLong("supplier_id"),
        rs.getLong("outlet_id"),
        rs.getString("currency_code"),
        rs.getString("payment_method"),
        rs.getBigDecimal("amount"),
        rs.getString("status"),
        rs.getTimestamp("payment_time").toInstant(),
        rs.getString("transaction_ref"),
        rs.getString("note"),
        rs.getObject("created_by_user_id", Long.class),
        rs.getTimestamp("created_at").toInstant(),
        rs.getTimestamp("updated_at").toInstant()
    );
  }

  private void bindParams(PreparedStatement ps, List<Object> params) throws SQLException {
    for (int i = 0; i < params.size(); i++) {
      Object value = params.get(i);
      if (value instanceof Long longValue) {
        ps.setLong(i + 1, longValue);
      } else if (value instanceof String stringValue) {
        ps.setString(i + 1, stringValue);
      } else if (value instanceof Integer intValue) {
        ps.setInt(i + 1, intValue);
      } else if (value instanceof Timestamp timestamp) {
        ps.setTimestamp(i + 1, timestamp);
      } else {
        ps.setObject(i + 1, value);
      }
    }
  }

  private void appendInClause(
      StringBuilder sql,
      List<Object> params,
      String column,
      Set<Long> values
  ) {
    if (values == null) {
      return;
    }
    sql.append(" AND ").append(column).append(" IN (");
    boolean first = true;
    for (Long value : values) {
      if (!first) {
        sql.append(", ");
      }
      sql.append("?");
      params.add(value);
      first = false;
    }
    sql.append(")");
  }

  private static LocalDate toLocalDate(Date value) {
    return value == null ? null : value.toLocalDate();
  }

  private static Instant toInstant(Timestamp value) {
    return value == null ? null : value.toInstant();
  }
}
