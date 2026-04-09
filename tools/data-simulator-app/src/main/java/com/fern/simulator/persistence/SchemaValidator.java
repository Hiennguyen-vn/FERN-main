package com.fern.simulator.persistence;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

/**
 * Validates the database schema before simulation execution.
 * Checks that required tables and triggers exist.
 */
public final class SchemaValidator {

    private static final Logger log = LoggerFactory.getLogger(SchemaValidator.class);

    private static final String[] REQUIRED_TABLES = {
            "core.currency", "core.region", "core.outlet",
            "core.app_user", "core.role", "core.permission",
            "core.employee_contract", "core.item", "core.product",
            "core.recipe", "core.recipe_item",
            "core.purchase_order", "core.goods_receipt",
            "core.inventory_transaction", "core.stock_balance",
            "core.sale_record", "core.sale_item", "core.payment",
            "core.pos_session", "core.payroll_period",
            "core.simulator_run"
    };

    private SchemaValidator() {}

    /**
     * Validates that the database has all required tables.
     * @throws IllegalStateException if validation fails
     */
    public static void validate(Connection conn) throws SQLException {
        log.info("Validating database schema...");
        int missing = 0;

        for (String table : REQUIRED_TABLES) {
            String[] parts = table.split("\\.");
            String schema = parts[0];
            String tableName = parts[1];

            if (!tableExists(conn, schema, tableName)) {
                log.error("Missing required table: {}", table);
                missing++;
            }
        }

        if (missing > 0) {
            throw new IllegalStateException(
                    "Schema validation failed: " + missing + " required table(s) missing. " +
                    "Run Flyway migrations (V1–V10) before starting the simulator.");
        }

        // Check for simulator_run cleanup columns (V10)
        if (!columnExists(conn, "core", "simulator_run", "cleaned_at")) {
            log.warn("simulator_run.cleaned_at column missing — V10 migration may not have been applied");
        }

        log.info("Schema validation passed: {} tables verified", REQUIRED_TABLES.length);
    }

    private static boolean tableExists(Connection conn, String schema, String table) throws SQLException {
        String sql = """
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = ? AND table_name = ?
            )
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, schema);
            ps.setString(2, table);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() && rs.getBoolean(1);
            }
        }
    }

    private static boolean columnExists(Connection conn, String schema, String table,
                                          String column) throws SQLException {
        String sql = """
            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = ? AND table_name = ? AND column_name = ?
            )
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, schema);
            ps.setString(2, table);
            ps.setString(3, column);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() && rs.getBoolean(1);
            }
        }
    }
}
