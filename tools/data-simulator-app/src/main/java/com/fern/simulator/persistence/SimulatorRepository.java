package com.fern.simulator.persistence;

import com.fern.simulator.model.*;
import com.natsu.common.utils.security.PasswordUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.sql.*;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;

/**
 * Primary JDBC repository for persisting all simulator-generated entities.
 * All writes use raw SQL with PreparedStatements in FK-safe insertion order.
 *
 * <h3>Insertion order (respects foreign keys):</h3>
 * <ol>
 *   <li>region</li>
 *   <li>outlet</li>
 *   <li>app_user → user_role, user_permission, employee_contract</li>
 *   <li>item → product → recipe, recipe_item → product_price, product_outlet_availability</li>
 *   <li>supplier_procurement</li>
 *   <li>purchase_order → purchase_order_item → goods_receipt → goods_receipt_item</li>
 *   <li>inventory_transaction (triggers stock_balance sync)</li>
 *   <li>pos_session → sale_record → sale_item → payment → sale_item_transaction</li>
 *   <li>payroll_period → payroll_timesheet → payroll</li>
 *   <li>promotion → promotion_scope</li>
 *   <li>stock_count_session → stock_count_line</li>
 *   <li>expense_record</li>
 * </ol>
 */
public final class SimulatorRepository {

    private static final Logger log = LoggerFactory.getLogger(SimulatorRepository.class);

    // Pre-computed password hash for "123123123"
    private static final String DEFAULT_PASSWORD_HASH;

    static {
        try {
            DEFAULT_PASSWORD_HASH = PasswordUtil.hash("123123123");
        } catch (Exception e) {
            throw new RuntimeException("Failed to compute default password hash", e);
        }
    }

    private SimulatorRepository() {}

    // ==================== REGION ====================

    public static void insertRegion(Connection conn, long id, String code, String name,
                                     String currencyCode, String timezone,
                                     Long parentRegionId) throws SQLException {
        String sql = """
            INSERT INTO core.region (id, code, name, currency_code, timezone_name, parent_region_id)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (code) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, id);
            ps.setString(2, code);
            ps.setString(3, name);
            ps.setString(4, currencyCode);
            ps.setString(5, timezone);
            if (parentRegionId != null) ps.setLong(6, parentRegionId);
            else ps.setNull(6, Types.BIGINT);
            ps.executeUpdate();
        }
    }

    // ==================== OUTLET ====================

    public static void insertOutlet(Connection conn, SimOutlet outlet) throws SQLException {
        String sql = """
            INSERT INTO core.outlet (id, region_id, code, name, status, opened_at, closed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (code) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, outlet.getId());
            ps.setLong(2, outlet.getRegionId());
            ps.setString(3, outlet.getCode());
            ps.setString(4, outlet.getName());
            ps.setObject(5, outlet.getStatus(), Types.OTHER);
            ps.setDate(6, outlet.getOpenedDate() != null ? Date.valueOf(outlet.getOpenedDate()) : null);
            ps.setNull(7, Types.DATE); // closed_at initially null
            ps.executeUpdate();
        }
    }

    public static void updateOutletStatus(Connection conn, long outletId, String status,
                                           LocalDate closedAt) throws SQLException {
        String sql = """
            UPDATE core.outlet SET status = ?, closed_at = ?
            WHERE id = ?
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setObject(1, status, Types.OTHER);
            ps.setDate(2, closedAt != null ? Date.valueOf(closedAt) : null);
            ps.setLong(3, outletId);
            ps.executeUpdate();
        }
    }

    // ==================== APP_USER + IAM ====================

    public static void insertAppUser(Connection conn, SimEmployee emp) throws SQLException {
        String sql = """
            INSERT INTO core.app_user (id, username, password_hash, full_name, employee_code, gender, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (username) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, emp.getUserId());
            ps.setString(2, emp.getUsername());
            ps.setString(3, DEFAULT_PASSWORD_HASH);
            ps.setString(4, emp.getFullName());
            ps.setString(5, emp.getEmployeeCode());
            ps.setObject(6, emp.getGender(), Types.OTHER);
            ps.setObject(7, emp.getUserStatus(), Types.OTHER);
            ps.executeUpdate();
        }
    }

    public static void insertUserRole(Connection conn, long userId, String roleCode,
                                       long outletId) throws SQLException {
        String sql = """
            INSERT INTO core.user_role (user_id, role_code, outlet_id)
            VALUES (?, ?, ?)
            ON CONFLICT (user_id, role_code, outlet_id) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, userId);
            ps.setString(2, roleCode);
            ps.setLong(3, outletId);
            ps.executeUpdate();
        }
    }

    public static void insertEmployeeContract(Connection conn, SimEmployee emp) throws SQLException {
        String sql = """
            INSERT INTO core.employee_contract (id, user_id, employment_type, salary_type,
                base_salary, currency_code, region_code, hire_date, start_date, end_date, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, emp.getContractId());
            ps.setLong(2, emp.getUserId());
            ps.setObject(3, emp.getEmploymentType(), Types.OTHER);
            ps.setObject(4, emp.getSalaryType(), Types.OTHER);
            ps.setBigDecimal(5, java.math.BigDecimal.valueOf(emp.getBaseSalary()));
            ps.setString(6, emp.getCurrencyCode());
            ps.setString(7, emp.getRegionCode());
            ps.setDate(8, Date.valueOf(emp.getHireDate()));
            ps.setDate(9, Date.valueOf(emp.getHireDate()));
            ps.setNull(10, Types.DATE); // end_date null for active contracts
            ps.setObject(11, emp.getContractStatus(), Types.OTHER);
            ps.executeUpdate();
        }
    }

    // ==================== ITEM / PRODUCT / RECIPE ====================

    public static void insertItem(Connection conn, SimItem item) throws SQLException {
        String sql = """
            INSERT INTO core.item (id, code, name, category_code, base_uom_code, min_stock_level, max_stock_level, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
            ON CONFLICT (code) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, item.getId());
            ps.setString(2, item.getCode());
            ps.setString(3, item.getName());
            ps.setString(4, item.getCategoryCode());
            ps.setString(5, item.getUomCode());
            ps.setBigDecimal(6, java.math.BigDecimal.valueOf(item.getMinStockLevel()));
            ps.setBigDecimal(7, java.math.BigDecimal.valueOf(item.getMaxStockLevel()));
            ps.executeUpdate();
        }
    }

    public static void insertProduct(Connection conn, SimProduct product) throws SQLException {
        String sql = """
            INSERT INTO core.product (id, code, name, category_code, status)
            VALUES (?, ?, ?, ?, 'active')
            ON CONFLICT (code) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, product.id());
            ps.setString(2, product.code());
            ps.setString(3, product.name());
            ps.setString(4, product.categoryCode() != null ? product.categoryCode() : "MAIN_DISH");
            ps.executeUpdate();
        }
    }

    public static void insertRecipe(Connection conn, long productId, String version) throws SQLException {
        String sql = """
            INSERT INTO core.recipe (product_id, version, yield_qty, yield_uom_code, status)
            VALUES (?, ?, 1, 'portion', 'active')
            ON CONFLICT (product_id, version) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, productId);
            ps.setString(2, version);
            ps.executeUpdate();
        }
    }

    public static void insertRecipeItem(Connection conn, long productId, String version,
                                         long itemId, String uomCode, int qty) throws SQLException {
        String sql = """
            INSERT INTO core.recipe_item (product_id, version, item_id, uom_code, qty)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, productId);
            ps.setString(2, version);
            ps.setLong(3, itemId);
            ps.setString(4, uomCode);
            ps.setBigDecimal(5, java.math.BigDecimal.valueOf(qty));
            ps.executeUpdate();
        }
    }

    public static void insertProductPrice(Connection conn, long productId, long outletId,
                                           String currencyCode, long priceValue,
                                           LocalDate effectiveFrom) throws SQLException {
        String sql = """
            INSERT INTO core.product_price (product_id, outlet_id, currency_code, price_value, effective_from)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (product_id, outlet_id, effective_from) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, productId);
            ps.setLong(2, outletId);
            ps.setString(3, currencyCode);
            ps.setBigDecimal(4, java.math.BigDecimal.valueOf(priceValue));
            ps.setDate(5, Date.valueOf(effectiveFrom));
            ps.executeUpdate();
        }
    }

    public static void insertProductOutletAvailability(Connection conn, long productId,
                                                        long outletId) throws SQLException {
        String sql = """
            INSERT INTO core.product_outlet_availability (product_id, outlet_id, is_available)
            VALUES (?, ?, true)
            ON CONFLICT (product_id, outlet_id) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, productId);
            ps.setLong(2, outletId);
            ps.executeUpdate();
        }
    }

    // ==================== SUPPLIER ====================

    public static void insertSupplier(Connection conn, SimSupplier supplier,
                                       Long regionId) throws SQLException {
        String sql = """
            INSERT INTO core.supplier_procurement (id, region_id, supplier_code, name, status)
            VALUES (?, ?, ?, ?, 'active')
            ON CONFLICT (supplier_code) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, supplier.id());
            if (regionId != null) ps.setLong(2, regionId);
            else ps.setNull(2, Types.BIGINT);
            ps.setString(3, supplier.code());
            ps.setString(4, supplier.name());
            ps.executeUpdate();
        }
    }

    // ==================== PURCHASE ORDER ====================

    public static long insertPurchaseOrder(Connection conn, long poId, long supplierId,
                                            long outletId, String currencyCode,
                                            LocalDate orderDate, LocalDate expectedDelivery,
                                            Long createdByUserId, Long approvedByUserId,
                                            long expectedTotal, String note) throws SQLException {
        String sql = """
            INSERT INTO core.purchase_order (id, supplier_id, outlet_id, currency_code,
                order_date, expected_delivery_date, status, created_by_user_id,
                approved_by_user_id, approved_at, expected_total, note)
            VALUES (?, ?, ?, ?, ?, ?, 'ordered', ?, ?, NOW(), ?, ?)
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, poId);
            ps.setLong(2, supplierId);
            ps.setLong(3, outletId);
            ps.setString(4, currencyCode);
            ps.setDate(5, Date.valueOf(orderDate));
            ps.setDate(6, expectedDelivery != null ? Date.valueOf(expectedDelivery) : null);
            if (createdByUserId != null) ps.setLong(7, createdByUserId);
            else ps.setNull(7, Types.BIGINT);
            if (approvedByUserId != null) ps.setLong(8, approvedByUserId);
            else ps.setNull(8, Types.BIGINT);
            ps.setBigDecimal(9, java.math.BigDecimal.valueOf(expectedTotal));
            ps.setString(10, note);
            ps.executeUpdate();
        }
        return poId;
    }

    public static void updatePurchaseOrderStatus(Connection conn, long poId, String status) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement("""
                UPDATE core.purchase_order
                SET status = ?::core.po_status_enum
                WHERE id = ?
                """)) {
            ps.setString(1, status);
            ps.setLong(2, poId);
            ps.executeUpdate();
        }
    }

    public static void updatePurchaseOrderItemReceipt(Connection conn, long poId, long itemId,
                                                      int qtyReceived, String status,
                                                      String note) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement("""
                UPDATE core.purchase_order_item
                SET qty_received = ?, status = ?::core.po_item_status_enum, note = ?
                WHERE po_id = ? AND item_id = ?
                """)) {
            ps.setBigDecimal(1, java.math.BigDecimal.valueOf(qtyReceived));
            ps.setString(2, status);
            ps.setString(3, note);
            ps.setLong(4, poId);
            ps.setLong(5, itemId);
            ps.executeUpdate();
        }
    }

    public static void insertPurchaseOrderItem(Connection conn, long poId, long itemId,
                                                String uomCode, int qtyOrdered) throws SQLException {
        String sql = """
            INSERT INTO core.purchase_order_item (po_id, item_id, uom_code, qty_ordered)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (po_id, item_id) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, poId);
            ps.setLong(2, itemId);
            ps.setString(3, uomCode);
            ps.setBigDecimal(4, java.math.BigDecimal.valueOf(qtyOrdered));
            ps.executeUpdate();
        }
    }

    // ==================== GOODS RECEIPT ====================

    public static void insertGoodsReceipt(Connection conn, long grId, long poId,
                                           String currencyCode, OffsetDateTime receiptTime,
                                           LocalDate businessDate,
                                           long totalPrice, String status, String note,
                                           String supplierLotNumber, Long createdByUserId,
                                           Long approvedByUserId, OffsetDateTime approvedAt) throws SQLException {
        String sql = """
            INSERT INTO core.goods_receipt (id, po_id, currency_code, receipt_time,
                business_date, status, note, total_price, supplier_lot_number,
                created_by_user_id, approved_by_user_id, approved_at)
            VALUES (?, ?, ?, ?, ?, ?::core.receipt_status_enum, ?, ?, ?, ?, ?, ?)
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, grId);
            ps.setLong(2, poId);
            ps.setString(3, currencyCode);
            ps.setObject(4, receiptTime);
            ps.setDate(5, Date.valueOf(businessDate));
            ps.setString(6, status);
            ps.setString(7, note);
            ps.setBigDecimal(8, java.math.BigDecimal.valueOf(totalPrice));
            ps.setString(9, supplierLotNumber);
            if (createdByUserId != null) ps.setLong(10, createdByUserId);
            else ps.setNull(10, Types.BIGINT);
            if (approvedByUserId != null) ps.setLong(11, approvedByUserId);
            else ps.setNull(11, Types.BIGINT);
            ps.setObject(12, approvedAt);
            ps.executeUpdate();
        }
    }

    public static void insertGoodsReceiptItem(Connection conn, long griId, long receiptId,
                                               long poId, long itemId, String uomCode,
                                               int qtyReceived, long unitCost,
                                               LocalDate manufactureDate, LocalDate expiryDate,
                                               String note) throws SQLException {
        String sql = """
            INSERT INTO core.goods_receipt_item (id, receipt_id, po_id, item_id, uom_code,
                qty_received, unit_cost, line_total, manufacture_date, expiry_date, note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, griId);
            ps.setLong(2, receiptId);
            ps.setLong(3, poId);
            ps.setLong(4, itemId);
            ps.setString(5, uomCode);
            ps.setBigDecimal(6, java.math.BigDecimal.valueOf(qtyReceived));
            ps.setBigDecimal(7, java.math.BigDecimal.valueOf(unitCost));
            ps.setBigDecimal(8, java.math.BigDecimal.valueOf((long) qtyReceived * unitCost));
            if (manufactureDate != null) ps.setDate(9, Date.valueOf(manufactureDate));
            else ps.setNull(9, Types.DATE);
            if (expiryDate != null) ps.setDate(10, Date.valueOf(expiryDate));
            else ps.setNull(10, Types.DATE);
            ps.setString(11, note);
            ps.executeUpdate();
        }
    }

    // ==================== INVENTORY TRANSACTION ====================

    public static void insertInventoryTransaction(Connection conn, long txnId, long outletId,
                                                    long itemId, int qtyChange, LocalDate businessDate,
                                                    OffsetDateTime txnTime, String txnType,
                                                    Long unitCost) throws SQLException {
        String sql = """
            INSERT INTO core.inventory_transaction (id, outlet_id, item_id, qty_change,
                business_date, txn_time, txn_type, unit_cost)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, txnId);
            ps.setLong(2, outletId);
            ps.setLong(3, itemId);
            ps.setBigDecimal(4, java.math.BigDecimal.valueOf(qtyChange));
            ps.setDate(5, Date.valueOf(businessDate));
            ps.setObject(6, txnTime);
            ps.setObject(7, txnType, Types.OTHER);
            if (unitCost != null) ps.setBigDecimal(8, java.math.BigDecimal.valueOf(unitCost));
            else ps.setNull(8, Types.NUMERIC);
            ps.executeUpdate();
        }
    }

    // ==================== POS SESSION ====================

    public static void insertPosSession(Connection conn, long id, String sessionCode,
                                         long outletId, String currencyCode,
                                         Long managerId, OffsetDateTime openedAt,
                                         OffsetDateTime closedAt, LocalDate businessDate,
                                         String status) throws SQLException {
        String sql = """
            INSERT INTO core.pos_session (id, session_code, outlet_id, currency_code,
                manager_id, opened_at, closed_at, business_date, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
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
            ps.executeUpdate();
        }
    }

    // ==================== SALE RECORD ====================

    public static void insertSaleRecord(Connection conn, long id, long outletId,
                                         Long posSessionId, String currencyCode,
                                         String orderType, String status,
                                         String paymentStatus, long subtotal,
                                         long discount, long taxAmount,
                                         long totalAmount) throws SQLException {
        String sql = """
            INSERT INTO core.sale_record (id, outlet_id, pos_session_id, currency_code,
                order_type, status, payment_status, subtotal, discount, tax_amount, total_amount)
            VALUES (?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?)
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
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
            ps.executeUpdate();
        }
    }

    public static void insertSaleItem(Connection conn, long saleId, long productId,
                                       long unitPrice, int qty, long discountAmount,
                                       long taxAmount, long lineTotal) throws SQLException {
        String sql = """
            INSERT INTO core.sale_item (sale_id, product_id, unit_price, qty,
                discount_amount, tax_amount, line_total)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (sale_id, product_id) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, saleId);
            ps.setLong(2, productId);
            ps.setBigDecimal(3, java.math.BigDecimal.valueOf(unitPrice));
            ps.setBigDecimal(4, java.math.BigDecimal.valueOf(qty));
            ps.setBigDecimal(5, java.math.BigDecimal.valueOf(discountAmount));
            ps.setBigDecimal(6, java.math.BigDecimal.valueOf(taxAmount));
            ps.setBigDecimal(7, java.math.BigDecimal.valueOf(lineTotal));
            ps.executeUpdate();
        }
    }

    // ==================== PAYMENT ====================

    public static void insertPayment(Connection conn, long saleId, Long posSessionId,
                                      String paymentMethod, long amount, String status,
                                      OffsetDateTime paymentTime) throws SQLException {
        String sql = """
            INSERT INTO core.payment (sale_id, pos_session_id, payment_method,
                amount, status, payment_time)
            VALUES (?, ?, ?, ?, ?, ?)
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, saleId);
            if (posSessionId != null) ps.setLong(2, posSessionId);
            else ps.setNull(2, Types.BIGINT);
            ps.setObject(3, paymentMethod, Types.OTHER);
            ps.setBigDecimal(4, java.math.BigDecimal.valueOf(amount));
            ps.setObject(5, status, Types.OTHER);
            ps.setObject(6, paymentTime);
            ps.executeUpdate();
        }
    }

    // ==================== PAYROLL ====================

    public static long ensurePayrollPeriod(Connection conn, long id, long regionId,
                                           String name, LocalDate startDate,
                                           LocalDate endDate, LocalDate payDate) throws SQLException {
        String sql = """
            INSERT INTO core.payroll_period (id, region_id, name, start_date, end_date, pay_date)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (region_id, start_date, end_date)
            DO UPDATE SET
                name = EXCLUDED.name,
                pay_date = EXCLUDED.pay_date
            RETURNING id
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, id);
            ps.setLong(2, regionId);
            ps.setString(3, name);
            ps.setDate(4, Date.valueOf(startDate));
            ps.setDate(5, Date.valueOf(endDate));
            ps.setDate(6, payDate != null ? Date.valueOf(payDate) : null);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    return rs.getLong(1);
                }
            }
        }
        throw new SQLException("Failed to resolve payroll_period id for region " + regionId
                + " and range " + startDate + " - " + endDate);
    }

    public static void insertPayrollTimesheet(Connection conn, long id, long periodId,
                                               long userId, Long outletId,
                                               int workDays) throws SQLException {
        String sql = """
            INSERT INTO core.payroll_timesheet (id, payroll_period_id, user_id, outlet_id, work_days, work_hours)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (payroll_period_id, user_id) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, id);
            ps.setLong(2, periodId);
            ps.setLong(3, userId);
            if (outletId != null) ps.setLong(4, outletId);
            else ps.setNull(4, Types.BIGINT);
            ps.setBigDecimal(5, java.math.BigDecimal.valueOf(workDays));
            ps.setBigDecimal(6, java.math.BigDecimal.valueOf(workDays * 8L)); // 8h/day
            ps.executeUpdate();
        }
    }

    public static void insertPayroll(Connection conn, long id, long timesheetId,
                                      String currencyCode, long baseSalary,
                                      long netSalary) throws SQLException {
        String sql = """
            INSERT INTO core.payroll (id, payroll_timesheet_id, currency_code,
                base_salary_amount, net_salary, status)
            VALUES (?, ?, ?, ?, ?, 'paid')
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, id);
            ps.setLong(2, timesheetId);
            ps.setString(3, currencyCode);
            ps.setBigDecimal(4, java.math.BigDecimal.valueOf(baseSalary));
            ps.setBigDecimal(5, java.math.BigDecimal.valueOf(netSalary));
            ps.executeUpdate();
        }
    }

    // ==================== PROMOTION ====================

    public static void insertPromotion(Connection conn, SimPromotion promo) throws SQLException {
        String sql = """
            INSERT INTO core.promotion (id, name, promo_type, status, value_percent,
                effective_from, effective_to)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, promo.getId());
            ps.setString(2, promo.getName());
            ps.setObject(3, promo.getType(), Types.OTHER);
            ps.setObject(4, promo.getStatus(), Types.OTHER);
            ps.setBigDecimal(5, java.math.BigDecimal.valueOf(promo.getDiscountValue()));
            ps.setObject(6, promo.getEffectiveFrom().atStartOfDay().atZone(ZoneId.systemDefault()).toOffsetDateTime());
            ps.setObject(7, promo.getEffectiveTo().atStartOfDay().atZone(ZoneId.systemDefault()).toOffsetDateTime());
            ps.executeUpdate();
        }
    }

    // ==================== WASTE ====================

    public static void insertWasteRecord(Connection conn, long txnId,
                                          String reason, Long approvedByUserId) throws SQLException {
        String sql = """
            INSERT INTO core.waste_record (inventory_transaction_id, reason, approved_by_user_id)
            VALUES (?, ?, ?)
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, txnId);
            ps.setString(2, reason);
            if (approvedByUserId != null) ps.setLong(3, approvedByUserId);
            else ps.setNull(3, Types.BIGINT);
            ps.executeUpdate();
        }
    }

    // ==================== SALE_ITEM_TRANSACTION ====================

    public static void insertSaleItemTransaction(Connection conn, long txnId,
                                                   long saleId, long productId,
                                                   long itemId) throws SQLException {
        String sql = """
            INSERT INTO core.sale_item_transaction (inventory_transaction_id, sale_id, product_id, item_id)
            VALUES (?, ?, ?, ?)
            ON CONFLICT DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, txnId);
            ps.setLong(2, saleId);
            ps.setLong(3, productId);
            ps.setLong(4, itemId);
            ps.executeUpdate();
        }
    }

    // ==================== GOODS_RECEIPT_TRANSACTION ====================

    public static void insertGoodsReceiptTransaction(Connection conn, long txnId,
                                                       long griId) throws SQLException {
        String sql = """
            INSERT INTO core.goods_receipt_transaction (inventory_transaction_id, goods_receipt_item_id)
            VALUES (?, ?)
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, txnId);
            ps.setLong(2, griId);
            ps.executeUpdate();
        }
    }

    // ==================== EXPENSE RECORD ====================

    public static void insertExpenseRecord(Connection conn, long id, long outletId,
                                            LocalDate businessDate, String currencyCode,
                                            long amount, String sourceType,
                                            String note) throws SQLException {
        String sql = """
            INSERT INTO core.expense_record (id, outlet_id, business_date, currency_code,
                amount, source_type, note)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, id);
            ps.setLong(2, outletId);
            ps.setDate(3, Date.valueOf(businessDate));
            ps.setString(4, currencyCode);
            ps.setBigDecimal(5, java.math.BigDecimal.valueOf(amount));
            ps.setObject(6, sourceType, Types.OTHER);
            ps.setString(7, note);
            ps.executeUpdate();
        }
    }

    // ==================== SUPPLIER INVOICE ====================

    public static void insertSupplierInvoice(Connection conn, long id, String invoiceNumber,
                                              long supplierId, String currencyCode,
                                              LocalDate invoiceDate, LocalDate dueDate,
                                              long subtotal, long taxAmount,
                                              long totalAmount, String status, String note) throws SQLException {
        String sql = """
            INSERT INTO core.supplier_invoice (id, invoice_number, supplier_id, currency_code,
                invoice_date, due_date, subtotal, tax_amount, total_amount, status, note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?::core.supplier_invoice_status_enum, ?)
            ON CONFLICT (supplier_id, invoice_number) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, id);
            ps.setString(2, invoiceNumber);
            ps.setLong(3, supplierId);
            ps.setString(4, currencyCode);
            ps.setDate(5, Date.valueOf(invoiceDate));
            ps.setDate(6, dueDate != null ? Date.valueOf(dueDate) : null);
            ps.setBigDecimal(7, java.math.BigDecimal.valueOf(subtotal));
            ps.setBigDecimal(8, java.math.BigDecimal.valueOf(taxAmount));
            ps.setBigDecimal(9, java.math.BigDecimal.valueOf(totalAmount));
            ps.setString(10, status);
            ps.setString(11, note);
            ps.executeUpdate();
        }
    }

    public static void insertSupplierInvoiceReceipt(Connection conn, long invoiceId,
                                                      long receiptId) throws SQLException {
        String sql = """
            INSERT INTO core.supplier_invoice_receipt (invoice_id, receipt_id)
            VALUES (?, ?)
            ON CONFLICT (invoice_id, receipt_id) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, invoiceId);
            ps.setLong(2, receiptId);
            ps.executeUpdate();
        }
    }

    public static void insertSupplierInvoiceItem(Connection conn, long invoiceId,
                                                   int lineNumber, Long goodsReceiptItemId,
                                                   int qtyInvoiced, long unitPrice,
                                                   long taxAmount,
                                                   long lineTotal) throws SQLException {
        String sql = """
            INSERT INTO core.supplier_invoice_item (invoice_id, line_number, line_type,
                goods_receipt_item_id, qty_invoiced, unit_price, tax_amount, line_total)
            VALUES (?, ?, 'stock', ?, ?, ?, ?, ?)
            ON CONFLICT (invoice_id, line_number) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, invoiceId);
            ps.setInt(2, lineNumber);
            if (goodsReceiptItemId != null) ps.setLong(3, goodsReceiptItemId);
            else ps.setNull(3, Types.BIGINT);
            ps.setBigDecimal(4, java.math.BigDecimal.valueOf(qtyInvoiced));
            ps.setBigDecimal(5, java.math.BigDecimal.valueOf(unitPrice));
            ps.setBigDecimal(6, java.math.BigDecimal.valueOf(taxAmount));
            ps.setBigDecimal(7, java.math.BigDecimal.valueOf(lineTotal));
            ps.executeUpdate();
        }
    }

    // ==================== SUPPLIER PAYMENT ====================

    public static void insertSupplierPayment(Connection conn, long id, long supplierId,
                                              String currencyCode, String paymentMethod,
                                              long amount, OffsetDateTime paymentTime,
                                              String transactionRef, String note,
                                              Long createdByUserId) throws SQLException {
        String sql = """
            INSERT INTO core.supplier_payment (id, supplier_id, currency_code,
                payment_method, amount, status, payment_time, transaction_ref, note, created_by_user_id)
            VALUES (?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?)
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
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
            ps.executeUpdate();
        }
    }

    public static void insertSupplierPaymentAllocation(Connection conn, long paymentId,
                                                         long invoiceId,
                                                         long allocatedAmount) throws SQLException {
        String sql = """
            INSERT INTO core.supplier_payment_allocation (payment_id, invoice_id, allocated_amount)
            VALUES (?, ?, ?)
            ON CONFLICT (payment_id, invoice_id) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, paymentId);
            ps.setLong(2, invoiceId);
            ps.setBigDecimal(3, java.math.BigDecimal.valueOf(allocatedAmount));
            ps.executeUpdate();
        }
    }

    // ==================== ITEM CATEGORY ====================

    public static void insertItemCategory(Connection conn, String code,
                                           String name) throws SQLException {
        String sql = """
            INSERT INTO core.item_category (code, name) VALUES (?, ?)
            ON CONFLICT (code) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, code);
            ps.setString(2, name);
            ps.executeUpdate();
        }
    }

    // ==================== UNIT OF MEASURE ====================

    public static void insertUom(Connection conn, String code, String name) throws SQLException {
        String sql = """
            INSERT INTO core.unit_of_measure (code, name) VALUES (?, ?)
            ON CONFLICT (code) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, code);
            ps.setString(2, name);
            ps.executeUpdate();
        }
    }

    // ==================== PRODUCT CATEGORY ====================

    public static void insertProductCategory(Connection conn, String code,
                                              String name) throws SQLException {
        String sql = """
            INSERT INTO core.product_category (code, name) VALUES (?, ?)
            ON CONFLICT (code) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, code);
            ps.setString(2, name);
            ps.executeUpdate();
        }
    }

    // ==================== STOCK BALANCE ====================

    public static void upsertStockBalance(Connection conn, long outletId, long itemId,
                                            int qtyOnHand, long unitCost,
                                            LocalDate countDate) throws SQLException {
        String sql = """
            INSERT INTO core.stock_balance (location_id, item_id, qty_on_hand, unit_cost, last_count_date, updated_at)
            VALUES (?, ?, ?, ?, ?, NOW())
            ON CONFLICT (location_id, item_id) DO UPDATE SET
                qty_on_hand = EXCLUDED.qty_on_hand,
                unit_cost = EXCLUDED.unit_cost,
                last_count_date = EXCLUDED.last_count_date,
                updated_at = NOW()
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, outletId);
            ps.setLong(2, itemId);
            ps.setBigDecimal(3, java.math.BigDecimal.valueOf(qtyOnHand));
            ps.setBigDecimal(4, java.math.BigDecimal.valueOf(unitCost));
            ps.setObject(5, countDate);
            ps.executeUpdate();
        }
    }

    // ==================== STOCK COUNT ====================

    public static void insertStockCountSession(Connection conn, long id, long outletId,
                                                 LocalDate countDate, String status) throws SQLException {
        String sql = """
            INSERT INTO core.stock_count_session (id, location_id, count_date, status)
            VALUES (?, ?, ?, ?::core.stock_count_status_enum)
            ON CONFLICT (id) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, id);
            ps.setLong(2, outletId);
            ps.setObject(3, countDate);
            ps.setString(4, status);
            ps.executeUpdate();
        }
    }

    public static void insertStockCountLine(Connection conn, long id, long sessionId,
                                              long itemId, int systemQty,
                                              int countedQty) throws SQLException {
        String sql = """
            INSERT INTO core.stock_count_line (id, stock_count_session_id, item_id, system_qty, actual_qty)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (stock_count_session_id, item_id) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, id);
            ps.setLong(2, sessionId);
            ps.setLong(3, itemId);
            ps.setBigDecimal(4, java.math.BigDecimal.valueOf(systemQty));
            ps.setBigDecimal(5, java.math.BigDecimal.valueOf(countedQty));
            ps.executeUpdate();
        }
    }

    // ==================== SHIFT & ORDERING TABLE ====================

    public static void insertShift(Connection conn, long id, long outletId,
                                    String code, String name, String startTime,
                                    String endTime, int breakMinutes) throws SQLException {
        String sql = """
            INSERT INTO core.shift (id, outlet_id, code, name, start_time, end_time, break_minutes)
            VALUES (?, ?, ?, ?, ?::time, ?::time, ?)
            ON CONFLICT (id) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, id);
            ps.setLong(2, outletId);
            ps.setString(3, code);
            ps.setString(4, name);
            ps.setString(5, startTime);
            ps.setString(6, endTime);
            ps.setInt(7, breakMinutes);
            ps.executeUpdate();
        }
    }

    public static void insertOrderingTable(Connection conn, long id, long outletId,
                                            String tableCode, String displayName,
                                            String publicToken) throws SQLException {
        String sql = """
            INSERT INTO core.ordering_table (id, outlet_id, table_code, display_name, public_token, status)
            VALUES (?, ?, ?, ?, ?, 'active'::core.ordering_table_status_enum)
            ON CONFLICT (id) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, id);
            ps.setLong(2, outletId);
            ps.setString(3, tableCode);
            ps.setString(4, displayName);
            ps.setString(5, publicToken);
            ps.executeUpdate();
        }
    }

    // ==================== WORK SHIFT ====================

    public static void insertWorkShift(Connection conn, long id, long shiftId,
                                        long userId, LocalDate workDate,
                                        String scheduleStatus, String attendanceStatus,
                                        String approvalStatus, OffsetDateTime actualStartTime,
                                        OffsetDateTime actualEndTime, Long assignedByUserId,
                                        Long approvedByUserId, String note) throws SQLException {
        String sql = """
            INSERT INTO core.work_shift (id, shift_id, user_id, work_date,
                schedule_status, attendance_status, approval_status,
                actual_start_time, actual_end_time, assigned_by_user_id, approved_by_user_id, note)
            VALUES (?, ?, ?, ?, ?::core.shift_schedule_status_enum,
                ?::core.attendance_status_enum, ?::core.approval_status_enum, ?, ?, ?, ?, ?)
            ON CONFLICT (shift_id, user_id, work_date) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, id);
            ps.setLong(2, shiftId);
            ps.setLong(3, userId);
            ps.setObject(4, workDate);
            ps.setString(5, scheduleStatus != null ? scheduleStatus : "scheduled");
            ps.setString(6, attendanceStatus != null ? attendanceStatus : "pending");
            ps.setString(7, approvalStatus != null ? approvalStatus : "pending");
            ps.setObject(8, actualStartTime);
            ps.setObject(9, actualEndTime);
            if (assignedByUserId != null) ps.setLong(10, assignedByUserId);
            else ps.setNull(10, Types.BIGINT);
            if (approvedByUserId != null) ps.setLong(11, approvedByUserId);
            else ps.setNull(11, Types.BIGINT);
            ps.setString(12, note);
            ps.executeUpdate();
        }
    }

    // ==================== PROMOTION SCOPE & SALE ITEM PROMOTION ====================

    public static void insertPromotionScope(Connection conn, long promotionId,
                                             long outletId) throws SQLException {
        String sql = """
            INSERT INTO core.promotion_scope (promotion_id, outlet_id)
            VALUES (?, ?)
            ON CONFLICT (promotion_id, outlet_id) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, promotionId);
            ps.setLong(2, outletId);
            ps.executeUpdate();
        }
    }

    public static void insertSaleItemPromotion(Connection conn, long saleId,
                                                long productId, long promotionId) throws SQLException {
        String sql = """
            INSERT INTO core.sale_item_promotion (sale_id, product_id, promotion_id)
            VALUES (?, ?, ?)
            ON CONFLICT (sale_id, product_id, promotion_id) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, saleId);
            ps.setLong(2, productId);
            ps.setLong(3, promotionId);
            ps.executeUpdate();
        }
    }

    // ==================== EXPENSE SUBTYPES ====================

    public static void insertExpenseOperating(Connection conn, long expenseRecordId,
                                               String description) throws SQLException {
        String sql = """
            INSERT INTO core.expense_operating (expense_record_id, description)
            VALUES (?, ?)
            ON CONFLICT (expense_record_id) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, expenseRecordId);
            ps.setString(2, description);
            ps.executeUpdate();
        }
    }

    public static void insertExpensePayroll(Connection conn, long expenseRecordId,
                                             long payrollId) throws SQLException {
        String sql = """
            INSERT INTO core.expense_payroll (expense_record_id, payroll_id)
            VALUES (?, ?)
            ON CONFLICT (expense_record_id) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, expenseRecordId);
            ps.setLong(2, payrollId);
            ps.executeUpdate();
        }
    }

    public static void insertExpenseInventoryPurchase(Connection conn, long expenseRecordId,
                                                       long goodsReceiptId) throws SQLException {
        String sql = """
            INSERT INTO core.expense_inventory_purchase (expense_record_id, goods_receipt_id)
            VALUES (?, ?)
            ON CONFLICT (expense_record_id) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, expenseRecordId);
            ps.setLong(2, goodsReceiptId);
            ps.executeUpdate();
        }
    }

    public static void insertExpenseOther(Connection conn, long expenseRecordId,
                                           String description) throws SQLException {
        String sql = """
            INSERT INTO core.expense_other (expense_record_id, description)
            VALUES (?, ?)
            ON CONFLICT (expense_record_id) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, expenseRecordId);
            ps.setString(2, description);
            ps.executeUpdate();
        }
    }

    // ==================== AUTH SESSION ====================

    public static void insertAuthSession(Connection conn, String sessionId, long userId,
                                          java.time.OffsetDateTime issuedAt,
                                          java.time.OffsetDateTime expiresAt,
                                          String userAgent, String clientIp) throws SQLException {
        String sql = """
            INSERT INTO core.auth_session (session_id, user_id, issued_at, expires_at, user_agent, client_ip)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (session_id) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, sessionId);
            ps.setLong(2, userId);
            ps.setObject(3, issuedAt);
            ps.setObject(4, expiresAt);
            ps.setString(5, userAgent);
            ps.setString(6, clientIp);
            ps.executeUpdate();
        }
    }

    // ==================== AUDIT LOG ====================

    public static void insertAuditLog(Connection conn, long id, Long actorUserId,
                                       String action, String entityName,
                                       String entityId, String reason) throws SQLException {
        String sql = """
            INSERT INTO core.audit_log (id, actor_user_id, action, entity_name, entity_id, reason)
            VALUES (?, ?, ?::core.audit_action_enum, ?, ?, ?)
            ON CONFLICT (id) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, id);
            if (actorUserId != null) ps.setLong(2, actorUserId); else ps.setNull(2, java.sql.Types.BIGINT);
            ps.setString(3, action);
            ps.setString(4, entityName);
            ps.setString(5, entityId);
            ps.setString(6, reason);
            ps.executeUpdate();
        }
    }

    // ==================== INVENTORY ADJUSTMENT ====================

    public static void insertInventoryAdjustment(Connection conn, long txnId,
                                                   Long stockCountLineId,
                                                   String reason, Long approvedByUserId) throws SQLException {
        String sql = """
            INSERT INTO core.inventory_adjustment (inventory_transaction_id, stock_count_line_id, reason, approved_by_user_id)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (inventory_transaction_id) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, txnId);
            if (stockCountLineId != null) ps.setLong(2, stockCountLineId); else ps.setNull(2, java.sql.Types.BIGINT);
            ps.setString(3, reason);
            if (approvedByUserId != null) ps.setLong(4, approvedByUserId); else ps.setNull(4, java.sql.Types.BIGINT);
            ps.executeUpdate();
        }
    }

    // ==================== MANUFACTURING BATCH ====================

    public static void insertManufacturingBatch(Connection conn, long id, long outletId,
                                                  String referenceCode, LocalDate businessDate) throws SQLException {
        String sql = """
            INSERT INTO core.manufacturing_batch (id, outlet_id, reference_code, business_date)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (id) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, id);
            ps.setLong(2, outletId);
            ps.setString(3, referenceCode);
            ps.setObject(4, businessDate);
            ps.executeUpdate();
        }
    }

    public static void insertManufacturingTransaction(Connection conn, long txnId,
                                                        long batchId) throws SQLException {
        String sql = """
            INSERT INTO core.manufacturing_transaction (inventory_transaction_id, manufacturing_batch_id)
            VALUES (?, ?)
            ON CONFLICT (inventory_transaction_id) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, txnId);
            ps.setLong(2, batchId);
            ps.executeUpdate();
        }
    }

    // ==================== TAX RATE ====================

    public static void insertTaxRate(Connection conn, long regionId, long productId,
                                      java.math.BigDecimal taxPercent,
                                      LocalDate effectiveFrom) throws SQLException {
        String sql = """
            INSERT INTO core.tax_rate (region_id, product_id, tax_percent, effective_from)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (region_id, product_id, effective_from) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, regionId);
            ps.setLong(2, productId);
            ps.setBigDecimal(3, taxPercent);
            ps.setObject(4, effectiveFrom);
            ps.executeUpdate();
        }
    }
}
