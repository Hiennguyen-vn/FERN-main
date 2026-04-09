package com.fern.simulator.persistence;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Cleanup of simulator-owned data. Ownership is anchored on simulator namespaces
 * recorded in {@code core.simulator_run}; individual business rows are discovered
 * from those namespaces and deleted in FK-safe reverse dependency order.
 */
public final class CleanupRepository {

    private static final Logger log = LoggerFactory.getLogger(CleanupRepository.class);

    private static final String[] TEMP_TABLES = {
            "tmp_cleanup_outlet_ids",
            "tmp_cleanup_user_ids",
            "tmp_cleanup_product_ids",
            "tmp_cleanup_promotion_ids",
            "tmp_cleanup_item_ids",
            "tmp_cleanup_supplier_ids",
            "tmp_cleanup_expense_ids",
            "tmp_cleanup_sale_ids",
            "tmp_cleanup_inventory_txn_ids",
            "tmp_cleanup_shift_ids",
            "tmp_cleanup_payroll_period_ids",
            "tmp_cleanup_timesheet_ids",
            "tmp_cleanup_po_ids",
            "tmp_cleanup_gr_ids",
            "tmp_cleanup_gri_ids",
            "tmp_cleanup_stock_count_session_ids",
            "tmp_cleanup_mfg_batch_ids",
            "tmp_cleanup_invoice_ids",
            "tmp_cleanup_payment_ids"
    };
    /**
     * Number of ordered delete/mark steps in {@link #execute(Connection, String, CleanupProgressListener)}.
     * Keep this value in sync if the execution sequence is changed.
     */
    private static final int CLEANUP_DELETE_STEP_COUNT = 53;

    private CleanupRepository() {}

    public record CleanupStepProgress(
            String namespace,
            String step,
            int completedSteps,
            int totalSteps,
            long stepRowsDeleted,
            long cumulativeRowsDeleted
    ) {}

    @FunctionalInterface
    public interface CleanupProgressListener {
        void onProgress(CleanupStepProgress progress);
    }

    public record NamespaceSummary(
            String namespace,
            int runCount,
            String latestStatus,
            OffsetDateTime lastStartedAt,
            OffsetDateTime cleanedAt
    ) {}

    public static int cleanupDeleteStepCount() {
        return CLEANUP_DELETE_STEP_COUNT;
    }

    public static List<NamespaceSummary> listNamespaces(Connection conn) throws SQLException {
        List<NamespaceSummary> namespaces = new ArrayList<>();
        try (PreparedStatement ps = conn.prepareStatement("""
                SELECT namespace,
                       COUNT(*) AS run_count,
                       (ARRAY_AGG(status ORDER BY started_at DESC))[1] AS latest_status,
                       MAX(started_at) AS last_started_at,
                       MAX(cleaned_at) AS cleaned_at
                FROM core.simulator_run
                GROUP BY namespace
                ORDER BY MAX(started_at) DESC
                """)) {
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    namespaces.add(new NamespaceSummary(
                            rs.getString("namespace"),
                            rs.getInt("run_count"),
                            rs.getString("latest_status"),
                            rs.getObject("last_started_at", OffsetDateTime.class),
                            rs.getObject("cleaned_at", OffsetDateTime.class)
                    ));
                }
            }
        }
        return namespaces;
    }

    /**
     * Preview cleanup for a single namespace.
     */
    public static Map<String, Long> preview(Connection conn, String namespace) throws SQLException {
        prepareScope(conn, namespace);
        Map<String, Long> counts = new LinkedHashMap<>();
        counts.put("supplier_payment_allocation", count(conn, "SELECT COUNT(*) FROM core.supplier_payment_allocation WHERE payment_id IN (SELECT id FROM tmp_cleanup_payment_ids)"));
        counts.put("supplier_payment", count(conn, "SELECT COUNT(*) FROM core.supplier_payment WHERE id IN (SELECT id FROM tmp_cleanup_payment_ids)"));
        counts.put("supplier_invoice_item", count(conn, "SELECT COUNT(*) FROM core.supplier_invoice_item WHERE invoice_id IN (SELECT id FROM tmp_cleanup_invoice_ids)"));
        counts.put("supplier_invoice_receipt", count(conn, "SELECT COUNT(*) FROM core.supplier_invoice_receipt WHERE invoice_id IN (SELECT id FROM tmp_cleanup_invoice_ids)"));
        counts.put("supplier_invoice", count(conn, "SELECT COUNT(*) FROM core.supplier_invoice WHERE id IN (SELECT id FROM tmp_cleanup_invoice_ids)"));
        counts.put("sale_item_promotion", count(conn, "SELECT COUNT(*) FROM core.sale_item_promotion WHERE sale_id IN (SELECT id FROM tmp_cleanup_sale_ids)"));
        counts.put("promotion_scope", count(conn, "SELECT COUNT(*) FROM core.promotion_scope WHERE outlet_id IN (SELECT id FROM tmp_cleanup_outlet_ids)"));
        counts.put("promotion", count(conn, "SELECT COUNT(*) FROM core.promotion WHERE id IN (SELECT id FROM tmp_cleanup_promotion_ids)"));
        counts.put("expense_operating", count(conn, "SELECT COUNT(*) FROM core.expense_operating WHERE expense_record_id IN (SELECT id FROM tmp_cleanup_expense_ids)"));
        counts.put("expense_payroll", count(conn, "SELECT COUNT(*) FROM core.expense_payroll WHERE expense_record_id IN (SELECT id FROM tmp_cleanup_expense_ids)"));
        counts.put("expense_inventory_purchase", count(conn, "SELECT COUNT(*) FROM core.expense_inventory_purchase WHERE expense_record_id IN (SELECT id FROM tmp_cleanup_expense_ids)"));
        counts.put("expense_other", count(conn, "SELECT COUNT(*) FROM core.expense_other WHERE expense_record_id IN (SELECT id FROM tmp_cleanup_expense_ids)"));
        counts.put("auth_session", count(conn, "SELECT COUNT(*) FROM core.auth_session WHERE user_id IN (SELECT id FROM tmp_cleanup_user_ids)"));
        counts.put("audit_log", count(conn, """
                SELECT COUNT(*) FROM core.audit_log
                WHERE actor_user_id IN (SELECT id FROM tmp_cleanup_user_ids)
                   OR (entity_name = 'outlet' AND entity_id IN (SELECT id::text FROM tmp_cleanup_outlet_ids))
                """));
        counts.put("inventory_adjustment", count(conn, "SELECT COUNT(*) FROM core.inventory_adjustment WHERE inventory_transaction_id IN (SELECT id FROM tmp_cleanup_inventory_txn_ids)"));
        counts.put("goods_receipt_transaction", count(conn, "SELECT COUNT(*) FROM core.goods_receipt_transaction WHERE goods_receipt_item_id IN (SELECT id FROM tmp_cleanup_gri_ids)"));
        counts.put("manufacturing_transaction", count(conn, "SELECT COUNT(*) FROM core.manufacturing_transaction WHERE manufacturing_batch_id IN (SELECT id FROM tmp_cleanup_mfg_batch_ids)"));
        counts.put("manufacturing_batch", count(conn, "SELECT COUNT(*) FROM core.manufacturing_batch WHERE id IN (SELECT id FROM tmp_cleanup_mfg_batch_ids)"));
        counts.put("work_shift", count(conn, "SELECT COUNT(*) FROM core.work_shift WHERE shift_id IN (SELECT id FROM tmp_cleanup_shift_ids)"));
        counts.put("shift", count(conn, "SELECT COUNT(*) FROM core.shift WHERE id IN (SELECT id FROM tmp_cleanup_shift_ids)"));
        counts.put("ordering_table", count(conn, "SELECT COUNT(*) FROM core.ordering_table WHERE outlet_id IN (SELECT id FROM tmp_cleanup_outlet_ids)"));
        counts.put("tax_rate", count(conn, "SELECT COUNT(*) FROM core.tax_rate WHERE product_id IN (SELECT id FROM tmp_cleanup_product_ids)"));
        counts.put("expense_record", count(conn, "SELECT COUNT(*) FROM core.expense_record WHERE id IN (SELECT id FROM tmp_cleanup_expense_ids)"));
        counts.put("waste_record", count(conn, "SELECT COUNT(*) FROM core.waste_record WHERE inventory_transaction_id IN (SELECT id FROM tmp_cleanup_inventory_txn_ids)"));
        counts.put("inventory_transaction", count(conn, "SELECT COUNT(*) FROM core.inventory_transaction WHERE id IN (SELECT id FROM tmp_cleanup_inventory_txn_ids)"));
        counts.put("sale_item_transaction", count(conn, "SELECT COUNT(*) FROM core.sale_item_transaction WHERE sale_id IN (SELECT id FROM tmp_cleanup_sale_ids)"));
        counts.put("payment", count(conn, "SELECT COUNT(*) FROM core.payment WHERE sale_id IN (SELECT id FROM tmp_cleanup_sale_ids)"));
        counts.put("sale_item", count(conn, "SELECT COUNT(*) FROM core.sale_item WHERE sale_id IN (SELECT id FROM tmp_cleanup_sale_ids)"));
        counts.put("sale_record", count(conn, "SELECT COUNT(*) FROM core.sale_record WHERE id IN (SELECT id FROM tmp_cleanup_sale_ids)"));
        counts.put("pos_session", count(conn, "SELECT COUNT(*) FROM core.pos_session WHERE outlet_id IN (SELECT id FROM tmp_cleanup_outlet_ids)"));
        counts.put("payroll", count(conn, "SELECT COUNT(*) FROM core.payroll WHERE payroll_timesheet_id IN (SELECT id FROM tmp_cleanup_timesheet_ids)"));
        counts.put("payroll_timesheet", count(conn, "SELECT COUNT(*) FROM core.payroll_timesheet WHERE id IN (SELECT id FROM tmp_cleanup_timesheet_ids)"));
        counts.put("payroll_period", count(conn, "SELECT COUNT(*) FROM core.payroll_period WHERE id IN (SELECT id FROM tmp_cleanup_payroll_period_ids)"));
        counts.put("goods_receipt_item", count(conn, "SELECT COUNT(*) FROM core.goods_receipt_item WHERE id IN (SELECT id FROM tmp_cleanup_gri_ids)"));
        counts.put("goods_receipt", count(conn, "SELECT COUNT(*) FROM core.goods_receipt WHERE id IN (SELECT id FROM tmp_cleanup_gr_ids)"));
        counts.put("purchase_order_item", count(conn, "SELECT COUNT(*) FROM core.purchase_order_item WHERE po_id IN (SELECT id FROM tmp_cleanup_po_ids)"));
        counts.put("purchase_order", count(conn, "SELECT COUNT(*) FROM core.purchase_order WHERE id IN (SELECT id FROM tmp_cleanup_po_ids)"));
        counts.put("supplier_procurement", count(conn, "SELECT COUNT(*) FROM core.supplier_procurement WHERE id IN (SELECT id FROM tmp_cleanup_supplier_ids)"));
        counts.put("product_outlet_availability", count(conn, "SELECT COUNT(*) FROM core.product_outlet_availability WHERE product_id IN (SELECT id FROM tmp_cleanup_product_ids)"));
        counts.put("product_price", count(conn, "SELECT COUNT(*) FROM core.product_price WHERE product_id IN (SELECT id FROM tmp_cleanup_product_ids)"));
        counts.put("recipe_item", count(conn, "SELECT COUNT(*) FROM core.recipe_item WHERE product_id IN (SELECT id FROM tmp_cleanup_product_ids)"));
        counts.put("recipe", count(conn, "SELECT COUNT(*) FROM core.recipe WHERE product_id IN (SELECT id FROM tmp_cleanup_product_ids)"));
        counts.put("product", count(conn, "SELECT COUNT(*) FROM core.product WHERE id IN (SELECT id FROM tmp_cleanup_product_ids)"));
        counts.put("stock_count_line", count(conn, "SELECT COUNT(*) FROM core.stock_count_line WHERE stock_count_session_id IN (SELECT id FROM tmp_cleanup_stock_count_session_ids)"));
        counts.put("stock_count_session", count(conn, "SELECT COUNT(*) FROM core.stock_count_session WHERE id IN (SELECT id FROM tmp_cleanup_stock_count_session_ids)"));
        counts.put("stock_balance", count(conn, "SELECT COUNT(*) FROM core.stock_balance WHERE location_id IN (SELECT id FROM tmp_cleanup_outlet_ids)"));
        counts.put("item", count(conn, "SELECT COUNT(*) FROM core.item WHERE id IN (SELECT id FROM tmp_cleanup_item_ids)"));
        counts.put("employee_contract", count(conn, "SELECT COUNT(*) FROM core.employee_contract WHERE user_id IN (SELECT id FROM tmp_cleanup_user_ids)"));
        counts.put("user_permission", count(conn, """
                SELECT COUNT(*) FROM core.user_permission
                WHERE user_id IN (SELECT id FROM tmp_cleanup_user_ids)
                   OR outlet_id IN (SELECT id FROM tmp_cleanup_outlet_ids)
                """));
        counts.put("user_role", count(conn, """
                SELECT COUNT(*) FROM core.user_role
                WHERE user_id IN (SELECT id FROM tmp_cleanup_user_ids)
                   OR outlet_id IN (SELECT id FROM tmp_cleanup_outlet_ids)
                """));
        counts.put("app_user", count(conn, "SELECT COUNT(*) FROM core.app_user WHERE id IN (SELECT id FROM tmp_cleanup_user_ids)"));
        counts.put("outlet", count(conn, "SELECT COUNT(*) FROM core.outlet WHERE id IN (SELECT id FROM tmp_cleanup_outlet_ids)"));
        counts.put("simulator_run", count(conn, "SELECT COUNT(*) FROM core.simulator_run WHERE namespace = " + sqlString(namespace)));
        return counts;
    }

    /**
     * Execute cleanup for a single namespace. Caller is responsible for the transaction.
     */
    public static Map<String, Long> execute(Connection conn, String namespace) throws SQLException {
        return execute(conn, namespace, null);
    }

    /**
     * Execute cleanup for a single namespace with optional step-level progress callbacks.
     * Caller is responsible for the surrounding transaction.
     */
    public static Map<String, Long> execute(Connection conn, String namespace,
                                            CleanupProgressListener progressListener) throws SQLException {
        prepareScope(conn, namespace);
        Map<String, Long> deleted = new LinkedHashMap<>();
        ProgressTracker tracker = new ProgressTracker(namespace, progressListener);
        runDeleteStep(conn, deleted, tracker, "supplier_payment_allocation", "core.supplier_payment_allocation spa", "spa",
                "spa.payment_id IN (SELECT id FROM tmp_cleanup_payment_ids)");
        runDeleteStep(conn, deleted, tracker, "supplier_payment", "core.supplier_payment sp", "sp",
                "sp.id IN (SELECT id FROM tmp_cleanup_payment_ids)");
        runDeleteStep(conn, deleted, tracker, "supplier_invoice_item", "core.supplier_invoice_item sii", "sii",
                "sii.invoice_id IN (SELECT id FROM tmp_cleanup_invoice_ids)");
        runDeleteStep(conn, deleted, tracker, "supplier_invoice_receipt", "core.supplier_invoice_receipt sir", "sir",
                "sir.invoice_id IN (SELECT id FROM tmp_cleanup_invoice_ids)");
        runDeleteStep(conn, deleted, tracker, "supplier_invoice", "core.supplier_invoice si", "si",
                "si.id IN (SELECT id FROM tmp_cleanup_invoice_ids)");
        runDeleteStep(conn, deleted, tracker, "sale_item_promotion", "core.sale_item_promotion sip", "sip",
                "sip.sale_id IN (SELECT id FROM tmp_cleanup_sale_ids)");
        runDeleteStep(conn, deleted, tracker, "promotion_scope", "core.promotion_scope ps", "ps",
                "ps.outlet_id IN (SELECT id FROM tmp_cleanup_outlet_ids)");
        runDeleteStep(conn, deleted, tracker, "promotion", "core.promotion promo", "promo",
                "promo.id IN (SELECT id FROM tmp_cleanup_promotion_ids)");
        runDeleteStep(conn, deleted, tracker, "expense_operating", "core.expense_operating eo", "eo",
                "eo.expense_record_id IN (SELECT id FROM tmp_cleanup_expense_ids)");
        runDeleteStep(conn, deleted, tracker, "expense_payroll", "core.expense_payroll ep", "ep",
                "ep.expense_record_id IN (SELECT id FROM tmp_cleanup_expense_ids)");
        runDeleteStep(conn, deleted, tracker, "expense_inventory_purchase", "core.expense_inventory_purchase eip", "eip",
                "eip.expense_record_id IN (SELECT id FROM tmp_cleanup_expense_ids)");
        runDeleteStep(conn, deleted, tracker, "expense_other", "core.expense_other eot", "eot",
                "eot.expense_record_id IN (SELECT id FROM tmp_cleanup_expense_ids)");
        runDeleteStep(conn, deleted, tracker, "auth_session", "core.auth_session auths", "auths",
                "auths.user_id IN (SELECT id FROM tmp_cleanup_user_ids)");
        runDeleteStep(conn, deleted, tracker, "audit_log", "core.audit_log alog", "alog", """
                alog.actor_user_id IN (SELECT id FROM tmp_cleanup_user_ids)
                   OR (alog.entity_name = 'outlet' AND alog.entity_id IN (SELECT id::text FROM tmp_cleanup_outlet_ids))
                """);
        runDeleteStep(conn, deleted, tracker, "inventory_adjustment", "core.inventory_adjustment ia", "ia",
                "ia.inventory_transaction_id IN (SELECT id FROM tmp_cleanup_inventory_txn_ids)");
        runDeleteStep(conn, deleted, tracker, "goods_receipt_transaction", "core.goods_receipt_transaction grt", "grt",
                "grt.goods_receipt_item_id IN (SELECT id FROM tmp_cleanup_gri_ids)");
        runDeleteStep(conn, deleted, tracker, "manufacturing_transaction", "core.manufacturing_transaction mt", "mt",
                "mt.manufacturing_batch_id IN (SELECT id FROM tmp_cleanup_mfg_batch_ids)");
        runDeleteStep(conn, deleted, tracker, "manufacturing_batch", "core.manufacturing_batch mb", "mb",
                "mb.id IN (SELECT id FROM tmp_cleanup_mfg_batch_ids)");
        runDeleteStep(conn, deleted, tracker, "work_shift", "core.work_shift ws", "ws",
                "ws.shift_id IN (SELECT id FROM tmp_cleanup_shift_ids)");
        runDeleteStep(conn, deleted, tracker, "shift", "core.shift sh", "sh",
                "sh.id IN (SELECT id FROM tmp_cleanup_shift_ids)");
        runDeleteStep(conn, deleted, tracker, "tax_rate", "core.tax_rate tr", "tr",
                "tr.product_id IN (SELECT id FROM tmp_cleanup_product_ids)");
        runDeleteStep(conn, deleted, tracker, "expense_record", "core.expense_record er", "er",
                "er.id IN (SELECT id FROM tmp_cleanup_expense_ids)");
        runDeleteStep(conn, deleted, tracker, "waste_record", "core.waste_record wr", "wr",
                "wr.inventory_transaction_id IN (SELECT id FROM tmp_cleanup_inventory_txn_ids)");
        runDeleteStep(conn, deleted, tracker, "sale_item_transaction", "core.sale_item_transaction sit", "sit",
                "sit.sale_id IN (SELECT id FROM tmp_cleanup_sale_ids)");
        runDeleteStep(conn, deleted, tracker, "inventory_transaction", "core.inventory_transaction itx", "itx",
                "itx.id IN (SELECT id FROM tmp_cleanup_inventory_txn_ids)");
        runDeleteStep(conn, deleted, tracker, "payment", "core.payment pay", "pay",
                "pay.sale_id IN (SELECT id FROM tmp_cleanup_sale_ids)");
        runDeleteStep(conn, deleted, tracker, "sale_item", "core.sale_item siem", "siem",
                "siem.sale_id IN (SELECT id FROM tmp_cleanup_sale_ids)");
        runDeleteStep(conn, deleted, tracker, "sale_record", "core.sale_record sr", "sr",
                "sr.id IN (SELECT id FROM tmp_cleanup_sale_ids)");
        runDeleteStep(conn, deleted, tracker, "ordering_table", "core.ordering_table ot", "ot",
                "ot.outlet_id IN (SELECT id FROM tmp_cleanup_outlet_ids)");
        runDeleteStep(conn, deleted, tracker, "pos_session", "core.pos_session poss", "poss",
                "poss.outlet_id IN (SELECT id FROM tmp_cleanup_outlet_ids)");
        runDeleteStep(conn, deleted, tracker, "payroll", "core.payroll pr", "pr",
                "pr.payroll_timesheet_id IN (SELECT id FROM tmp_cleanup_timesheet_ids)");
        runDeleteStep(conn, deleted, tracker, "payroll_timesheet", "core.payroll_timesheet pts", "pts",
                "pts.id IN (SELECT id FROM tmp_cleanup_timesheet_ids)");
        runDeleteStep(conn, deleted, tracker, "payroll_period", "core.payroll_period pp", "pp",
                "pp.id IN (SELECT id FROM tmp_cleanup_payroll_period_ids)");
        runDeleteStep(conn, deleted, tracker, "goods_receipt_item", "core.goods_receipt_item gri", "gri",
                "gri.id IN (SELECT id FROM tmp_cleanup_gri_ids)");
        runDeleteStep(conn, deleted, tracker, "goods_receipt", "core.goods_receipt gr", "gr",
                "gr.id IN (SELECT id FROM tmp_cleanup_gr_ids)");
        runDeleteStep(conn, deleted, tracker, "purchase_order_item", "core.purchase_order_item poi", "poi", """
                poi.po_id IN (SELECT id FROM tmp_cleanup_po_ids)
                  AND NOT EXISTS (
                    SELECT 1
                    FROM core.goods_receipt_item gri
                    WHERE gri.po_id = poi.po_id
                      AND gri.item_id = poi.item_id
                  )
                """);
        runDeleteStep(conn, deleted, tracker, "purchase_order", "core.purchase_order po", "po", """
                po.id IN (SELECT id FROM tmp_cleanup_po_ids)
                  AND NOT EXISTS (
                    SELECT 1
                    FROM core.goods_receipt gr
                    WHERE gr.po_id = po.id
                  )
                """);
        runDeleteStep(conn, deleted, tracker, "supplier_procurement", "core.supplier_procurement supp", "supp",
                "supp.id IN (SELECT id FROM tmp_cleanup_supplier_ids)");
        runDeleteStep(conn, deleted, tracker, "product_outlet_availability", "core.product_outlet_availability poa", "poa",
                "poa.product_id IN (SELECT id FROM tmp_cleanup_product_ids)");
        runDeleteStep(conn, deleted, tracker, "product_price", "core.product_price ppr", "ppr",
                "ppr.product_id IN (SELECT id FROM tmp_cleanup_product_ids)");
        runDeleteStep(conn, deleted, tracker, "recipe_item", "core.recipe_item ri", "ri",
                "ri.product_id IN (SELECT id FROM tmp_cleanup_product_ids)");
        runDeleteStep(conn, deleted, tracker, "recipe", "core.recipe rec", "rec",
                "rec.product_id IN (SELECT id FROM tmp_cleanup_product_ids)");
        runDeleteStep(conn, deleted, tracker, "product", "core.product prod", "prod",
                "prod.id IN (SELECT id FROM tmp_cleanup_product_ids)");
        runDeleteStep(conn, deleted, tracker, "stock_count_line", "core.stock_count_line scl", "scl",
                "scl.stock_count_session_id IN (SELECT id FROM tmp_cleanup_stock_count_session_ids)");
        runDeleteStep(conn, deleted, tracker, "stock_count_session", "core.stock_count_session scs", "scs",
                "scs.id IN (SELECT id FROM tmp_cleanup_stock_count_session_ids)");
        runDeleteStep(conn, deleted, tracker, "stock_balance", "core.stock_balance sb", "sb",
                "sb.location_id IN (SELECT id FROM tmp_cleanup_outlet_ids)");
        runDeleteStep(conn, deleted, tracker, "item", "core.item item", "item",
                "item.id IN (SELECT id FROM tmp_cleanup_item_ids)");
        runDeleteStep(conn, deleted, tracker, "employee_contract", "core.employee_contract ec", "ec",
                "ec.user_id IN (SELECT id FROM tmp_cleanup_user_ids)");
        runDeleteStep(conn, deleted, tracker, "user_permission", "core.user_permission up", "up", """
                up.user_id IN (SELECT id FROM tmp_cleanup_user_ids)
                   OR up.outlet_id IN (SELECT id FROM tmp_cleanup_outlet_ids)
                """);
        runDeleteStep(conn, deleted, tracker, "user_role", "core.user_role ur", "ur", """
                ur.user_id IN (SELECT id FROM tmp_cleanup_user_ids)
                   OR ur.outlet_id IN (SELECT id FROM tmp_cleanup_outlet_ids)
                """);
        runDeleteStep(conn, deleted, tracker, "app_user", "core.app_user au", "au",
                "au.id IN (SELECT id FROM tmp_cleanup_user_ids)");
        runDeleteStep(conn, deleted, tracker, "outlet", "core.outlet o", "o",
                "o.id IN (SELECT id FROM tmp_cleanup_outlet_ids)");
        runMarkRunsCleanedStep(conn, namespace, deleted, tracker, "simulator_run");

        long total = deleted.values().stream().mapToLong(Long::longValue).sum();
        if (total > 0) {
            log.info("Cleanup complete for namespace {}: {} total rows affected", namespace, total);
        }
        return deleted;
    }

    private static void runDeleteStep(Connection conn,
                                      Map<String, Long> deleted,
                                      ProgressTracker tracker,
                                      String key,
                                      String targetTableWithAlias,
                                      String alias,
                                      String whereClause) throws SQLException {
        long rows = deleteBatched(conn, targetTableWithAlias, alias, whereClause);
        deleted.put(key, rows);
        tracker.recordStep(key, rows);
    }

    private static void runMarkRunsCleanedStep(Connection conn,
                                               String namespace,
                                               Map<String, Long> deleted,
                                               ProgressTracker tracker,
                                               String key) throws SQLException {
        long rows = markRunsCleaned(conn, namespace, deleted);
        deleted.put(key, rows);
        tracker.recordStep(key, rows);
    }

    private static final class ProgressTracker {
        private final String namespace;
        private final CleanupProgressListener listener;
        private int completedSteps = 0;
        private long cumulativeRowsDeleted = 0L;

        private ProgressTracker(String namespace, CleanupProgressListener listener) {
            this.namespace = namespace;
            this.listener = listener;
        }

        private void recordStep(String step, long stepRowsDeleted) {
            completedSteps++;
            cumulativeRowsDeleted += stepRowsDeleted;
            if (listener != null) {
                listener.onProgress(new CleanupStepProgress(
                        namespace,
                        step,
                        completedSteps,
                        CLEANUP_DELETE_STEP_COUNT,
                        stepRowsDeleted,
                        cumulativeRowsDeleted
                ));
            }
        }
    }

    private static void prepareScope(Connection conn, String namespace) throws SQLException {
        dropTempTables(conn);
        createTempLike(conn, "tmp_cleanup_outlet_ids", "SELECT id FROM core.outlet WHERE code LIKE ?", namespace);
        createTempLike(conn, "tmp_cleanup_user_ids", "SELECT id FROM core.app_user WHERE employee_code LIKE ?", namespace);
        createTempLike(conn, "tmp_cleanup_product_ids", "SELECT id FROM core.product WHERE code LIKE ?", namespace);
        createTemp(conn, "tmp_cleanup_promotion_ids", """
                SELECT ps.promotion_id AS id
                FROM core.promotion_scope ps
                GROUP BY ps.promotion_id
                HAVING COUNT(*) FILTER (WHERE ps.outlet_id IN (SELECT id FROM tmp_cleanup_outlet_ids)) > 0
                   AND COUNT(*) FILTER (WHERE ps.outlet_id NOT IN (SELECT id FROM tmp_cleanup_outlet_ids)) = 0
                """);
        createTempLike(conn, "tmp_cleanup_item_ids", "SELECT id FROM core.item WHERE code LIKE ?", namespace);
        createTempLike(conn, "tmp_cleanup_supplier_ids", "SELECT id FROM core.supplier_procurement WHERE supplier_code LIKE ?", namespace);
        createTemp(conn, "tmp_cleanup_expense_ids", "SELECT id FROM core.expense_record WHERE outlet_id IN (SELECT id FROM tmp_cleanup_outlet_ids)");
        createTemp(conn, "tmp_cleanup_sale_ids", "SELECT id FROM core.sale_record WHERE outlet_id IN (SELECT id FROM tmp_cleanup_outlet_ids)");
        createTemp(conn, "tmp_cleanup_inventory_txn_ids", "SELECT id FROM core.inventory_transaction WHERE outlet_id IN (SELECT id FROM tmp_cleanup_outlet_ids)");
        createTemp(conn, "tmp_cleanup_shift_ids", "SELECT id FROM core.shift WHERE outlet_id IN (SELECT id FROM tmp_cleanup_outlet_ids)");
        createTemp(conn, "tmp_cleanup_timesheet_ids",
                "SELECT id FROM core.payroll_timesheet WHERE user_id IN (SELECT id FROM tmp_cleanup_user_ids)");
        createTemp(conn, "tmp_cleanup_payroll_period_ids", """
                SELECT pp.id
                FROM core.payroll_period pp
                WHERE EXISTS (
                    SELECT 1
                    FROM core.payroll_timesheet pts
                    WHERE pts.payroll_period_id = pp.id
                      AND pts.id IN (SELECT id FROM tmp_cleanup_timesheet_ids)
                )
                  AND NOT EXISTS (
                    SELECT 1
                    FROM core.payroll_timesheet pts
                    WHERE pts.payroll_period_id = pp.id
                      AND pts.id NOT IN (SELECT id FROM tmp_cleanup_timesheet_ids)
                )
                """);
        createTemp(conn, "tmp_cleanup_po_ids", "SELECT id FROM core.purchase_order WHERE outlet_id IN (SELECT id FROM tmp_cleanup_outlet_ids)");
        createTemp(conn, "tmp_cleanup_gr_ids", "SELECT id FROM core.goods_receipt WHERE po_id IN (SELECT id FROM tmp_cleanup_po_ids)");
        createTemp(conn, "tmp_cleanup_gri_ids", """
                SELECT id
                FROM core.goods_receipt_item
                WHERE receipt_id IN (SELECT id FROM tmp_cleanup_gr_ids)
                   OR po_id IN (SELECT id FROM tmp_cleanup_po_ids)
                """);
        createTemp(conn, "tmp_cleanup_stock_count_session_ids", "SELECT id FROM core.stock_count_session WHERE location_id IN (SELECT id FROM tmp_cleanup_outlet_ids)");
        createTemp(conn, "tmp_cleanup_mfg_batch_ids", "SELECT id FROM core.manufacturing_batch WHERE outlet_id IN (SELECT id FROM tmp_cleanup_outlet_ids)");
        createTemp(conn, "tmp_cleanup_invoice_ids", "SELECT id FROM core.supplier_invoice WHERE supplier_id IN (SELECT id FROM tmp_cleanup_supplier_ids)");
        createTemp(conn, "tmp_cleanup_payment_ids", "SELECT id FROM core.supplier_payment WHERE supplier_id IN (SELECT id FROM tmp_cleanup_supplier_ids)");
        indexAndAnalyzeTempTables(conn);
    }

    private static void createTempLike(Connection conn, String tempTable, String sql, String namespace) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement("CREATE TEMP TABLE " + tempTable + " AS " + sql)) {
            ps.setString(1, namespace + "%");
            ps.execute();
        }
    }

    private static void createTemp(Connection conn, String tempTable, String sql) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement("CREATE TEMP TABLE " + tempTable + " AS " + sql)) {
            ps.execute();
        }
    }

    private static void dropTempTables(Connection conn) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement("DROP TABLE IF EXISTS " + String.join(", ", TEMP_TABLES))) {
            ps.execute();
        }
    }

    private static void indexAndAnalyzeTempTables(Connection conn) throws SQLException {
        for (String table : TEMP_TABLES) {
            try (PreparedStatement index = conn.prepareStatement(
                    "CREATE INDEX IF NOT EXISTS idx_" + table + "_id ON " + table + " (id)")) {
                index.execute();
            }
            try (PreparedStatement analyze = conn.prepareStatement("ANALYZE " + table)) {
                analyze.execute();
            }
        }
    }

    private static long count(Connection conn, String sql) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement(sql);
             ResultSet rs = ps.executeQuery()) {
            return rs.next() ? rs.getLong(1) : 0;
        }
    }

    private static long deleteBatched(Connection conn, String targetTableWithAlias, String alias,
                                      String whereClause) throws SQLException {
        String sql = "DELETE FROM " + targetTableWithAlias + " WHERE " + whereClause;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            long deleted = ps.executeUpdate();
            if (deleted > 0) {
                log.debug("Cleanup direct delete finished for {}: {} rows removed", targetTableWithAlias, deleted);
            }
            return deleted;
        }
    }

    private static long markRunsCleaned(Connection conn, String namespace, Map<String, Long> deleted) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement("""
                UPDATE core.simulator_run
                SET cleaned_at = NOW(),
                    cleanup_summary_json = ?
                WHERE namespace = ?
                  AND cleaned_at IS NULL
                """)) {
            ps.setString(1, toJson(deleted));
            ps.setString(2, namespace);
            return ps.executeUpdate();
        }
    }

    private static String toJson(Map<String, Long> deleted) {
        StringBuilder json = new StringBuilder("{");
        boolean first = true;
        for (var entry : deleted.entrySet()) {
            if (!first) json.append(',');
            json.append('"').append(entry.getKey()).append('"').append(':').append(entry.getValue());
            first = false;
        }
        json.append('}');
        return json.toString();
    }

    private static String sqlString(String value) {
        return '\'' + value.replace("'", "''") + '\'';
    }
}
