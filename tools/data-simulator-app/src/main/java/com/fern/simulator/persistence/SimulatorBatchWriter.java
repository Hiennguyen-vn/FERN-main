package com.fern.simulator.persistence;

import java.sql.Connection;
import java.sql.Date;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Types;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Reuses prepared statements and batches the simulator's highest-volume writes.
 * The day-level transaction boundaries stay unchanged; this only improves the
 * write path inside each persisted day.
 */
public final class SimulatorBatchWriter implements AutoCloseable {

    private static final int FLUSH_THRESHOLD = 4_000;

    private final Connection conn;
    private final Map<String, PreparedStatement> statements = new LinkedHashMap<>();
    private final Map<String, Boolean> pendingBatches = new LinkedHashMap<>();
    private int pendingOperations = 0;

    public SimulatorBatchWriter(Connection conn) {
        this.conn = conn;
    }

    public void insertPurchaseOrderItem(long poId, long itemId, String uomCode, int qtyOrdered,
                                        long expectedUnitPrice) throws SQLException {
        batch("purchase_order_item", """
            INSERT INTO core.purchase_order_item (po_id, item_id, uom_code, expected_unit_price, qty_ordered, status, note)
            VALUES (?, ?, ?, ?, ?, 'open', ?)
            ON CONFLICT (po_id, item_id) DO NOTHING
            """, ps -> {
            ps.setLong(1, poId);
            ps.setLong(2, itemId);
            ps.setString(3, uomCode);
            ps.setBigDecimal(4, java.math.BigDecimal.valueOf(expectedUnitPrice));
            ps.setBigDecimal(5, java.math.BigDecimal.valueOf(qtyOrdered));
            ps.setString(6, "Initial order quantity");
        });
    }

    public void insertGoodsReceiptItem(long griId, long receiptId, long poId, long itemId,
                                       String uomCode, int qtyReceived, long unitCost,
                                       LocalDate manufactureDate, LocalDate expiryDate, String note) throws SQLException {
        batch("goods_receipt_item", """
            INSERT INTO core.goods_receipt_item (id, receipt_id, po_id, item_id, uom_code,
                qty_received, unit_cost, line_total, manufacture_date, expiry_date, note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, ps -> {
            ps.setLong(1, griId);
            ps.setLong(2, receiptId);
            ps.setLong(3, poId);
            ps.setLong(4, itemId);
            ps.setString(5, uomCode);
            ps.setBigDecimal(6, java.math.BigDecimal.valueOf(qtyReceived));
            ps.setBigDecimal(7, java.math.BigDecimal.valueOf(unitCost));
            ps.setBigDecimal(8, java.math.BigDecimal.valueOf((long) qtyReceived * unitCost));
            ps.setObject(9, manufactureDate);
            ps.setObject(10, expiryDate);
            ps.setString(11, note);
        });
    }

    public void insertInventoryTransaction(long txnId, long outletId, long itemId, int qtyChange,
                                           LocalDate businessDate, OffsetDateTime txnTime,
                                           String txnType, Long unitCost) throws SQLException {
        insertInventoryTransaction(txnId, outletId, itemId, qtyChange, businessDate, txnTime, txnType, unitCost, null, null);
    }

    public void insertInventoryTransaction(long txnId, long outletId, long itemId, int qtyChange,
                                           LocalDate businessDate, OffsetDateTime txnTime,
                                           String txnType, Long unitCost, Long createdByUserId,
                                           String note) throws SQLException {
        batch("inventory_transaction", """
            INSERT INTO core.inventory_transaction (id, outlet_id, item_id, qty_change,
                business_date, txn_time, txn_type, unit_cost, created_by_user_id, note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, ps -> {
            ps.setLong(1, txnId);
            ps.setLong(2, outletId);
            ps.setLong(3, itemId);
            ps.setBigDecimal(4, java.math.BigDecimal.valueOf(qtyChange));
            ps.setDate(5, Date.valueOf(businessDate));
            ps.setObject(6, txnTime);
            ps.setObject(7, txnType, Types.OTHER);
            if (unitCost != null) ps.setBigDecimal(8, java.math.BigDecimal.valueOf(unitCost));
            else ps.setNull(8, Types.NUMERIC);
            if (createdByUserId != null) ps.setLong(9, createdByUserId);
            else ps.setNull(9, Types.BIGINT);
            ps.setString(10, note);
        });
    }

    public void insertGoodsReceiptTransaction(long txnId, long goodsReceiptItemId) throws SQLException {
        batch("goods_receipt_transaction", """
            INSERT INTO core.goods_receipt_transaction (inventory_transaction_id, goods_receipt_item_id)
            VALUES (?, ?)
            """, ps -> {
            ps.setLong(1, txnId);
            ps.setLong(2, goodsReceiptItemId);
        });
    }

    public void insertPosSession(long id, String sessionCode, long outletId, String currencyCode,
                                 Long managerId, OffsetDateTime openedAt, OffsetDateTime closedAt,
                                 LocalDate businessDate, String status) throws SQLException {
        batch("pos_session", """
            INSERT INTO core.pos_session (id, session_code, outlet_id, currency_code,
                manager_id, opened_at, closed_at, business_date, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, ps -> {
            ps.setLong(1, id);
            ps.setString(2, sessionCode);
            ps.setLong(3, outletId);
            ps.setString(4, currencyCode);
            if (managerId != null) ps.setLong(5, managerId);
            else ps.setNull(5, Types.BIGINT);
            ps.setObject(6, openedAt);
            ps.setObject(7, closedAt);
            ps.setDate(8, Date.valueOf(businessDate));
            ps.setObject(9, status, Types.OTHER);
        });
    }

    public void insertSaleRecord(long id, long outletId, Long posSessionId, String currencyCode,
                                 String orderType, String status, String paymentStatus,
                                 long subtotal, long discount, long taxAmount,
                                 long totalAmount, Long orderingTableId) throws SQLException {
        batch("sale_record", """
            INSERT INTO core.sale_record (id, outlet_id, pos_session_id, currency_code,
                order_type, status, payment_status, subtotal, discount, tax_amount, total_amount, ordering_table_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, ps -> {
            ps.setLong(1, id);
            ps.setLong(2, outletId);
            if (posSessionId != null) ps.setLong(3, posSessionId);
            else ps.setNull(3, Types.BIGINT);
            ps.setString(4, currencyCode);
            ps.setObject(5, orderType, Types.OTHER);
            ps.setObject(6, status, Types.OTHER);
            ps.setObject(7, paymentStatus, Types.OTHER);
            ps.setBigDecimal(8, java.math.BigDecimal.valueOf(subtotal));
            ps.setBigDecimal(9, java.math.BigDecimal.valueOf(discount));
            ps.setBigDecimal(10, java.math.BigDecimal.valueOf(taxAmount));
            ps.setBigDecimal(11, java.math.BigDecimal.valueOf(totalAmount));
            if (orderingTableId != null) ps.setLong(12, orderingTableId);
            else ps.setNull(12, Types.BIGINT);
        });
    }

    public void insertSaleItem(long saleId, long productId, long unitPrice, int qty,
                               long discountAmount, long taxAmount, long lineTotal) throws SQLException {
        batch("sale_item", """
            INSERT INTO core.sale_item (sale_id, product_id, unit_price, qty,
                discount_amount, tax_amount, line_total)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (sale_id, product_id) DO NOTHING
            """, ps -> {
            ps.setLong(1, saleId);
            ps.setLong(2, productId);
            ps.setBigDecimal(3, java.math.BigDecimal.valueOf(unitPrice));
            ps.setBigDecimal(4, java.math.BigDecimal.valueOf(qty));
            ps.setBigDecimal(5, java.math.BigDecimal.valueOf(discountAmount));
            ps.setBigDecimal(6, java.math.BigDecimal.valueOf(taxAmount));
            ps.setBigDecimal(7, java.math.BigDecimal.valueOf(lineTotal));
        });
    }

    public void insertPayment(long saleId, Long posSessionId, String paymentMethod,
                              long amount, String status, OffsetDateTime paymentTime,
                              String transactionRef, String note) throws SQLException {
        batch("payment", """
            INSERT INTO core.payment (sale_id, pos_session_id, payment_method,
                amount, status, payment_time, transaction_ref, note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, ps -> {
            ps.setLong(1, saleId);
            if (posSessionId != null) ps.setLong(2, posSessionId);
            else ps.setNull(2, Types.BIGINT);
            ps.setObject(3, paymentMethod, Types.OTHER);
            ps.setBigDecimal(4, java.math.BigDecimal.valueOf(amount));
            ps.setObject(5, status, Types.OTHER);
            ps.setObject(6, paymentTime);
            ps.setString(7, transactionRef);
            ps.setString(8, note);
        });
    }

    public void insertSaleItemTransaction(long txnId, long saleId, long productId, long itemId) throws SQLException {
        batch("sale_item_transaction", """
            INSERT INTO core.sale_item_transaction (inventory_transaction_id, sale_id, product_id, item_id)
            VALUES (?, ?, ?, ?)
            ON CONFLICT DO NOTHING
            """, ps -> {
            ps.setLong(1, txnId);
            ps.setLong(2, saleId);
            ps.setLong(3, productId);
            ps.setLong(4, itemId);
        });
    }

    public void insertPayrollTimesheet(long id, long periodId, long userId, Long outletId,
                                       int workDays, double workHours, double overtimeHours,
                                       double overtimeRate, int lateCount, double absentDays,
                                       Long approvedByUserId) throws SQLException {
        batch("payroll_timesheet", """
            INSERT INTO core.payroll_timesheet (id, payroll_period_id, user_id, outlet_id, work_days, work_hours,
                overtime_hours, overtime_rate, late_count, absent_days, approved_by_user_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (payroll_period_id, user_id) DO NOTHING
            """, ps -> {
            ps.setLong(1, id);
            ps.setLong(2, periodId);
            ps.setLong(3, userId);
            if (outletId != null) ps.setLong(4, outletId);
            else ps.setNull(4, Types.BIGINT);
            ps.setBigDecimal(5, java.math.BigDecimal.valueOf(workDays));
            ps.setBigDecimal(6, java.math.BigDecimal.valueOf(workHours));
            ps.setBigDecimal(7, java.math.BigDecimal.valueOf(overtimeHours));
            ps.setBigDecimal(8, java.math.BigDecimal.valueOf(overtimeRate));
            ps.setInt(9, lateCount);
            ps.setBigDecimal(10, java.math.BigDecimal.valueOf(absentDays));
            if (approvedByUserId != null) ps.setLong(11, approvedByUserId);
            else ps.setNull(11, Types.BIGINT);
        });
    }

    public void insertPayroll(long id, long timesheetId, String currencyCode, long baseSalary,
                              long netSalary) throws SQLException {
        batch("payroll", """
            INSERT INTO core.payroll (id, payroll_timesheet_id, currency_code,
                base_salary_amount, net_salary, status)
            VALUES (?, ?, ?, ?, ?, 'paid')
            """, ps -> {
            ps.setLong(1, id);
            ps.setLong(2, timesheetId);
            ps.setString(3, currencyCode);
            ps.setBigDecimal(4, java.math.BigDecimal.valueOf(baseSalary));
            ps.setBigDecimal(5, java.math.BigDecimal.valueOf(netSalary));
        });
    }

    public void insertWasteRecord(long txnId, String reason, Long approvedByUserId) throws SQLException {
        batch("waste_record", """
            INSERT INTO core.waste_record (inventory_transaction_id, reason, approved_by_user_id)
            VALUES (?, ?, ?)
            """, ps -> {
            ps.setLong(1, txnId);
            ps.setString(2, reason);
            if (approvedByUserId != null) ps.setLong(3, approvedByUserId);
            else ps.setNull(3, Types.BIGINT);
        });
    }

    public void insertSupplierInvoiceItem(long invoiceId, int lineNumber, Long goodsReceiptItemId,
                                          int qtyInvoiced, long unitPrice, long taxAmount,
                                          long lineTotal, String description, double taxPercent) throws SQLException {
        batch("supplier_invoice_item", """
            INSERT INTO core.supplier_invoice_item (invoice_id, line_number, line_type,
                goods_receipt_item_id, qty_invoiced, unit_price, tax_percent, tax_amount, line_total, description)
            VALUES (?, ?, 'stock', ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (invoice_id, line_number) DO NOTHING
            """, ps -> {
            ps.setLong(1, invoiceId);
            ps.setInt(2, lineNumber);
            if (goodsReceiptItemId != null) ps.setLong(3, goodsReceiptItemId);
            else ps.setNull(3, Types.BIGINT);
            ps.setBigDecimal(4, java.math.BigDecimal.valueOf(qtyInvoiced));
            ps.setBigDecimal(5, java.math.BigDecimal.valueOf(unitPrice));
            ps.setBigDecimal(6, java.math.BigDecimal.valueOf(taxPercent));
            ps.setBigDecimal(7, java.math.BigDecimal.valueOf(taxAmount));
            ps.setBigDecimal(8, java.math.BigDecimal.valueOf(lineTotal));
            ps.setString(9, description);
        });
    }

    public void insertSupplierPayment(long id, long supplierId, String currencyCode, String paymentMethod,
                                      long amount, OffsetDateTime paymentTime, String transactionRef,
                                      String note, Long createdByUserId) throws SQLException {
        batch("supplier_payment", """
            INSERT INTO core.supplier_payment (id, supplier_id, currency_code,
                payment_method, amount, status, payment_time, transaction_ref, note, created_by_user_id)
            VALUES (?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?)
            """, ps -> {
            ps.setLong(1, id);
            ps.setLong(2, supplierId);
            ps.setString(3, currencyCode);
            ps.setObject(4, paymentMethod, Types.OTHER);
            ps.setBigDecimal(5, java.math.BigDecimal.valueOf(amount));
            ps.setObject(6, paymentTime);
            ps.setString(7, transactionRef);
            ps.setString(8, note);
            if (createdByUserId != null) ps.setLong(9, createdByUserId);
            else ps.setNull(9, Types.BIGINT);
        });
    }

    public void insertSupplierPaymentAllocation(long paymentId, long invoiceId, long allocatedAmount) throws SQLException {
        batch("supplier_payment_allocation", """
            INSERT INTO core.supplier_payment_allocation (payment_id, invoice_id, allocated_amount)
            VALUES (?, ?, ?)
            ON CONFLICT (payment_id, invoice_id) DO NOTHING
            """, ps -> {
            ps.setLong(1, paymentId);
            ps.setLong(2, invoiceId);
            ps.setBigDecimal(3, java.math.BigDecimal.valueOf(allocatedAmount));
        });
    }

    public void insertExpenseRecord(long id, long outletId, LocalDate businessDate, String currencyCode,
                                    long amount, String sourceType, String note,
                                    Long createdByUserId) throws SQLException {
        batch("expense_record", """
            INSERT INTO core.expense_record (id, outlet_id, business_date, currency_code,
                amount, source_type, note, created_by_user_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, ps -> {
            ps.setLong(1, id);
            ps.setLong(2, outletId);
            ps.setDate(3, Date.valueOf(businessDate));
            ps.setString(4, currencyCode);
            ps.setBigDecimal(5, java.math.BigDecimal.valueOf(amount));
            ps.setObject(6, sourceType, Types.OTHER);
            ps.setString(7, note);
            if (createdByUserId != null) ps.setLong(8, createdByUserId);
            else ps.setNull(8, Types.BIGINT);
        });
    }

    public void upsertStockBalance(long outletId, long itemId, int qtyOnHand, long unitCost,
                                   LocalDate countDate) throws SQLException {
        batch("stock_balance", """
            INSERT INTO core.stock_balance (location_id, item_id, qty_on_hand, unit_cost, last_count_date, updated_at)
            VALUES (?, ?, ?, ?, ?, NOW())
            ON CONFLICT (location_id, item_id) DO UPDATE SET
                qty_on_hand = EXCLUDED.qty_on_hand,
                unit_cost = EXCLUDED.unit_cost,
                last_count_date = EXCLUDED.last_count_date,
                updated_at = NOW()
            """, ps -> {
            ps.setLong(1, outletId);
            ps.setLong(2, itemId);
            ps.setBigDecimal(3, java.math.BigDecimal.valueOf(qtyOnHand));
            ps.setBigDecimal(4, java.math.BigDecimal.valueOf(unitCost));
            ps.setObject(5, countDate);
        });
    }

    public void insertStockCountSession(long id, long outletId, LocalDate countDate, String status,
                                        Long countedByUserId, Long approvedByUserId, String note) throws SQLException {
        batch("stock_count_session", """
            INSERT INTO core.stock_count_session (id, location_id, count_date, status,
                counted_by_user_id, approved_by_user_id, note)
            VALUES (?, ?, ?, ?::core.stock_count_status_enum, ?, ?, ?)
            ON CONFLICT (id) DO NOTHING
            """, ps -> {
            ps.setLong(1, id);
            ps.setLong(2, outletId);
            ps.setObject(3, countDate);
            ps.setString(4, status);
            if (countedByUserId != null) ps.setLong(5, countedByUserId);
            else ps.setNull(5, Types.BIGINT);
            if (approvedByUserId != null) ps.setLong(6, approvedByUserId);
            else ps.setNull(6, Types.BIGINT);
            ps.setString(7, note);
        });
    }

    public void insertStockCountLine(long id, long sessionId, long itemId,
                                     int systemQty, int countedQty) throws SQLException {
        batch("stock_count_line", """
            INSERT INTO core.stock_count_line (id, stock_count_session_id, item_id, system_qty, actual_qty)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (stock_count_session_id, item_id) DO NOTHING
            """, ps -> {
            ps.setLong(1, id);
            ps.setLong(2, sessionId);
            ps.setLong(3, itemId);
            ps.setBigDecimal(4, java.math.BigDecimal.valueOf(systemQty));
            ps.setBigDecimal(5, java.math.BigDecimal.valueOf(countedQty));
        });
    }

    public void insertWorkShift(long id, long shiftId, long userId, LocalDate workDate,
                                String scheduleStatus, String attendanceStatus, String approvalStatus,
                                OffsetDateTime actualStartTime, OffsetDateTime actualEndTime,
                                Long assignedByUserId, Long approvedByUserId, String note) throws SQLException {
        batch("work_shift", """
            INSERT INTO core.work_shift (id, shift_id, user_id, work_date,
                schedule_status, attendance_status, approval_status,
                actual_start_time, actual_end_time, assigned_by_user_id, approved_by_user_id, note)
            VALUES (?, ?, ?, ?, ?::core.shift_schedule_status_enum,
                ?::core.attendance_status_enum, ?::core.approval_status_enum, ?, ?, ?, ?, ?)
            ON CONFLICT (shift_id, user_id, work_date) DO NOTHING
            """, ps -> {
            ps.setLong(1, id);
            ps.setLong(2, shiftId);
            ps.setLong(3, userId);
            ps.setObject(4, workDate);
            ps.setString(5, scheduleStatus);
            ps.setString(6, attendanceStatus);
            ps.setString(7, approvalStatus);
            ps.setObject(8, actualStartTime);
            ps.setObject(9, actualEndTime);
            if (assignedByUserId != null) ps.setLong(10, assignedByUserId);
            else ps.setNull(10, Types.BIGINT);
            if (approvedByUserId != null) ps.setLong(11, approvedByUserId);
            else ps.setNull(11, Types.BIGINT);
            ps.setString(12, note);
        });
    }

    public void insertSaleItemPromotion(long saleId, long productId, long promotionId) throws SQLException {
        batch("sale_item_promotion", """
            INSERT INTO core.sale_item_promotion (sale_id, product_id, promotion_id)
            VALUES (?, ?, ?)
            ON CONFLICT DO NOTHING
            """, ps -> {
            ps.setLong(1, saleId);
            ps.setLong(2, productId);
            ps.setLong(3, promotionId);
        });
    }

    public void insertAuthSession(String sessionId, long userId, OffsetDateTime issuedAt, OffsetDateTime expiresAt,
                                  String userAgent, String clientIp) throws SQLException {
        batch("auth_session", """
            INSERT INTO core.auth_session (session_id, user_id, issued_at, expires_at, user_agent, client_ip)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (session_id) DO NOTHING
            """, ps -> {
            ps.setString(1, sessionId);
            ps.setLong(2, userId);
            ps.setObject(3, issuedAt);
            ps.setObject(4, expiresAt);
            ps.setString(5, userAgent);
            ps.setString(6, clientIp);
        });
    }

    public void insertInventoryAdjustment(long inventoryTransactionId, Long stockCountLineId,
                                          String reason, Long approvedByUserId) throws SQLException {
        batch("inventory_adjustment", """
            INSERT INTO core.inventory_adjustment (inventory_transaction_id, stock_count_line_id, reason, approved_by_user_id)
            VALUES (?, ?, ?, ?)
            ON CONFLICT DO NOTHING
            """, ps -> {
            ps.setLong(1, inventoryTransactionId);
            if (stockCountLineId != null) ps.setLong(2, stockCountLineId);
            else ps.setNull(2, Types.BIGINT);
            ps.setString(3, reason);
            if (approvedByUserId != null) ps.setLong(4, approvedByUserId);
            else ps.setNull(4, Types.BIGINT);
        });
    }

    public void insertManufacturingBatch(long id, long outletId, String refCode, LocalDate businessDate,
                                        String note, Long createdByUserId) throws SQLException {
        batch("manufacturing_batch", """
            INSERT INTO core.manufacturing_batch (id, outlet_id, reference_code, business_date, note, created_by_user_id)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (id) DO NOTHING
            """, ps -> {
            ps.setLong(1, id);
            ps.setLong(2, outletId);
            ps.setString(3, refCode);
            ps.setDate(4, Date.valueOf(businessDate));
            ps.setString(5, note);
            if (createdByUserId != null) ps.setLong(6, createdByUserId);
            else ps.setNull(6, Types.BIGINT);
        });
    }

    public void insertManufacturingTransaction(long inventoryTransactionId, long manufacturingBatchId) throws SQLException {
        batch("manufacturing_transaction", """
            INSERT INTO core.manufacturing_transaction (inventory_transaction_id, manufacturing_batch_id)
            VALUES (?, ?)
            ON CONFLICT DO NOTHING
            """, ps -> {
            ps.setLong(1, inventoryTransactionId);
            ps.setLong(2, manufacturingBatchId);
        });
    }

    public void insertPosReconciliation(long sessionId, Long reconciledByUserId, OffsetDateTime reconciledAt,
                                        long expectedTotal, long actualTotal, long discrepancyTotal,
                                        String note) throws SQLException {
        batch("pos_session_reconciliation", """
            INSERT INTO core.pos_session_reconciliation (session_id, reconciled_by_user_id, reconciled_at,
                expected_total, actual_total, discrepancy_total, note)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """, ps -> {
            ps.setLong(1, sessionId);
            if (reconciledByUserId != null) ps.setLong(2, reconciledByUserId);
            else ps.setNull(2, Types.BIGINT);
            ps.setObject(3, reconciledAt);
            ps.setBigDecimal(4, java.math.BigDecimal.valueOf(expectedTotal));
            ps.setBigDecimal(5, java.math.BigDecimal.valueOf(actualTotal));
            ps.setBigDecimal(6, java.math.BigDecimal.valueOf(discrepancyTotal));
            ps.setString(7, note);
        });
    }

    public void insertPosReconciliationLine(long sessionId, String paymentMethod,
                                             long expectedAmount, long actualAmount,
                                             long discrepancyAmount) throws SQLException {
        batch("pos_session_reconciliation_line", """
            INSERT INTO core.pos_session_reconciliation_line (session_id, payment_method,
                expected_amount, actual_amount, discrepancy_amount)
            VALUES (?, ?::core.payment_method_enum, ?, ?, ?)
            """, ps -> {
            ps.setLong(1, sessionId);
            ps.setString(2, paymentMethod);
            ps.setBigDecimal(3, java.math.BigDecimal.valueOf(expectedAmount));
            ps.setBigDecimal(4, java.math.BigDecimal.valueOf(actualAmount));
            ps.setBigDecimal(5, java.math.BigDecimal.valueOf(discrepancyAmount));
        });
    }

    public void updatePosSessionStatus(long sessionId, String status) throws SQLException {
        batch("pos_session_update_status", """
            UPDATE core.pos_session SET status = ?::core.pos_session_status_enum WHERE id = ?
            """, ps -> {
            ps.setString(1, status);
            ps.setLong(2, sessionId);
        });
    }

    public void flush() throws SQLException {
        for (var entry : statements.entrySet()) {
            String key = entry.getKey();
            if (!pendingBatches.getOrDefault(key, false)) {
                continue;
            }
            entry.getValue().executeBatch();
            pendingBatches.put(key, false);
        }
        pendingOperations = 0;
    }

    @Override
    public void close() throws SQLException {
        flush();
        SQLException failure = null;
        for (PreparedStatement statement : statements.values()) {
            try {
                statement.close();
            } catch (SQLException e) {
                if (failure == null) {
                    failure = e;
                } else {
                    failure.addSuppressed(e);
                }
            }
        }
        if (failure != null) {
            throw failure;
        }
    }

    private void batch(String key, String sql, SqlBinder binder) throws SQLException {
        PreparedStatement ps = statement(key, sql);
        binder.bind(ps);
        ps.addBatch();
        pendingBatches.put(key, true);
        pendingOperations++;
        if (pendingOperations >= FLUSH_THRESHOLD) {
            flush();
        }
    }

    private PreparedStatement statement(String key, String sql) throws SQLException {
        PreparedStatement existing = statements.get(key);
        if (existing != null) {
            return existing;
        }
        PreparedStatement created = conn.prepareStatement(sql);
        statements.put(key, created);
        pendingBatches.put(key, false);
        return created;
    }

    @FunctionalInterface
    private interface SqlBinder {
        void bind(PreparedStatement ps) throws SQLException;
    }
}
