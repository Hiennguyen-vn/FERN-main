package com.fern.simulator.persistence;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;

/**
 * Idempotent bootstrap of simulator-required reference data.
 * Creates roles, permissions, currencies, UOMs, and categories
 * using INSERT ... ON CONFLICT DO NOTHING.
 */
public final class BootstrapRepository {

    private static final Logger log = LoggerFactory.getLogger(BootstrapRepository.class);

    private BootstrapRepository() {}

    /**
     * Ensure all simulator-required reference data exists.
     * Safe to call multiple times (fully idempotent).
     */
    public static void bootstrap(Connection conn) throws SQLException {
        bootstrapCurrencies(conn);
        bootstrapUoms(conn);
        bootstrapUomConversions(conn);
        bootstrapExchangeRates(conn);
        bootstrapCategories(conn);
        bootstrapRoles(conn);
        bootstrapPermissions(conn);
        bootstrapRolePermissions(conn);
        log.info("Bootstrap complete: reference data ensured");
    }

    private static void bootstrapCurrencies(Connection conn) throws SQLException {
        String sql = """
            INSERT INTO core.currency (code, name, symbol, decimal_places)
            VALUES (?, ?, ?, ?)
            ON CONFLICT DO NOTHING
            """;
        String[][] currencies = {
                {"VND", "Vietnamese Dong", "₫", "0"},
                {"USD", "US Dollar", "$", "2"},
                {"JPY", "Japanese Yen", "¥", "0"},
                {"EUR", "Euro", "€", "2"}
        };
        for (String[] c : currencies) {
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setString(1, c[0]);
                ps.setString(2, c[1]);
                ps.setString(3, c[2]);
                ps.setInt(4, Integer.parseInt(c[3]));
                ps.executeUpdate();
            }
        }
    }

    private static void bootstrapUoms(Connection conn) throws SQLException {
        String sql = """
            INSERT INTO core.unit_of_measure (code, name)
            VALUES (?, ?)
            ON CONFLICT DO NOTHING
            """;
        String[][] uoms = {
                {"g", "Gram"}, {"kg", "Kilogram"}, {"ml", "Milliliter"},
                {"l", "Liter"}, {"pcs", "Piece"}, {"portion", "Portion"},
                {"pc", "Piece (pc)"}, {"L", "Liter (L)"}, {"serve", "Serving"}
        };
        for (String[] u : uoms) {
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setString(1, u[0]);
                ps.setString(2, u[1]);
                ps.executeUpdate();
            }
        }
    }

    private static void bootstrapCategories(Connection conn) throws SQLException {
        // Use individual inserts (not batch) with broad ON CONFLICT to handle both
        // code PK and name UNIQUE constraints safely.
        String itemCatSql = """
            INSERT INTO core.item_category (code, name, is_active)
            VALUES (?, ?, true)
            ON CONFLICT DO NOTHING
            """;
        String[][] itemCats = {
                {"RAW_MATERIAL", "Raw Material"},
                {"ingredient", "Ingredient"},
                {"PACKAGING", "Packaging"},
                {"PROTEIN", "Proteins & Meats"},
                {"NOODLE", "Noodles & Rice"},
                {"VEGETABLE", "Vegetables & Herbs"},
                {"AROMATIC", "Aromatics & Spices"},
                {"SAUCE", "Sauces & Condiments"},
                {"EGG_DAIRY", "Eggs & Dairy"},
                {"COMPOSITE", "Composite Ingredients"}
        };
        for (String[] cat : itemCats) {
            try (PreparedStatement ps = conn.prepareStatement(itemCatSql)) {
                ps.setString(1, cat[0]);
                ps.setString(2, cat[1]);
                ps.executeUpdate();
            }
        }

        String prodCatSql = """
            INSERT INTO core.product_category (code, name, is_active)
            VALUES (?, ?, true)
            ON CONFLICT DO NOTHING
            """;
        String[][] prodCats = {
                {"MAIN_DISH", "Main Dish"},
                {"APPETIZER", "Appetizer"},
                {"BEVERAGE", "Beverage"},
                {"DESSERT", "Dessert"},
                {"PHO_SOUP", "Pho & Noodle Soups"},
                {"RICE", "Rice Dishes"},
                {"BANH_MI", "Banh Mi & Wraps"},
                {"BUN", "Bun Noodle Dishes"},
                {"XAO", "Stir-Fry"},
                {"BANH", "Banh (Cakes/Pancakes)"},
                {"SIDE", "Sides & Appetizers"},
                {"DRINK", "Drinks & Desserts"}
        };
        for (String[] cat : prodCats) {
            try (PreparedStatement ps = conn.prepareStatement(prodCatSql)) {
                ps.setString(1, cat[0]);
                ps.setString(2, cat[1]);
                ps.executeUpdate();
            }
        }
    }

    private static void addCat(PreparedStatement ps, String code, String name) throws SQLException {
        ps.setString(1, code);
        ps.setString(2, name);
        ps.addBatch();
    }

    private static void bootstrapRoles(Connection conn) throws SQLException {
        String sql = """
            INSERT INTO core.role (code, name, description, status)
            VALUES (?, ?, ?, 'active')
            ON CONFLICT DO NOTHING
            """;
        String[][] roles = {
                {"admin", "Administrator", "Full system access"},
                {"outlet_manager", "Outlet Manager", "Outlet operations management"},
                {"cashier", "Cashier", "POS and sales operations"},
                {"inventory_clerk", "Inventory Clerk", "Stock management and goods receipt"},
                {"kitchen_staff", "Kitchen Staff", "Recipe fulfillment and waste reporting"}
        };
        for (String[] r : roles) {
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setString(1, r[0]);
                ps.setString(2, r[1]);
                ps.setString(3, r[2]);
                ps.executeUpdate();
            }
        }
    }

    private static void bootstrapPermissions(Connection conn) throws SQLException {
        String sql = """
            INSERT INTO core.permission (code, name, description)
            VALUES (?, ?, ?)
            ON CONFLICT DO NOTHING
            """;
        String[][] perms = {
                {"sales.order.write", "Create Sales Orders", "Create and manage sales orders"},
                {"inventory.adjust", "Adjust Inventory", "Perform inventory adjustments and stock counts"},
                {"procurement.po.write", "Create Purchase Orders", "Create and manage purchase orders"},
                {"hr.payroll.view", "View Payroll", "View payroll information"}
        };
        for (String[] p : perms) {
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setString(1, p[0]);
                ps.setString(2, p[1]);
                ps.setString(3, p[2]);
                ps.executeUpdate();
            }
        }
    }

    private static void bootstrapRolePermissions(Connection conn) throws SQLException {
        String sql = """
            INSERT INTO core.role_permission (role_code, permission_code)
            VALUES (?, ?)
            ON CONFLICT (role_code, permission_code) DO NOTHING
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, "cashier"); ps.setString(2, "sales.order.write"); ps.addBatch();
            ps.setString(1, "inventory_clerk"); ps.setString(2, "inventory.adjust"); ps.addBatch();
            ps.setString(1, "outlet_manager"); ps.setString(2, "sales.order.write"); ps.addBatch();
            ps.setString(1, "outlet_manager"); ps.setString(2, "inventory.adjust"); ps.addBatch();
            ps.setString(1, "outlet_manager"); ps.setString(2, "procurement.po.write"); ps.addBatch();
            ps.setString(1, "outlet_manager"); ps.setString(2, "hr.payroll.view"); ps.addBatch();
            ps.executeBatch();
        }
    }

    private static void bootstrapUomConversions(Connection conn) throws SQLException {
        String sql = """
            INSERT INTO core.uom_conversion (from_uom_code, to_uom_code, conversion_factor)
            VALUES (?, ?, ?)
            ON CONFLICT DO NOTHING
            """;
        // Note: CHECK constraint requires from_uom_code < to_uom_code (alphabetical order)
        String[][] conversions = {
                {"g", "kg", "0.001"},     // 1g = 0.001kg
                {"l", "ml", "1000.0"},    // 1L = 1000ml  (l < ml alphabetically)
                {"pc", "pcs", "1.0"},     // 1pc = 1pcs
        };
        for (String[] c : conversions) {
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setString(1, c[0]);
                ps.setString(2, c[1]);
                ps.setBigDecimal(3, new java.math.BigDecimal(c[2]));
                ps.executeUpdate();
            }
        }
    }

    private static void bootstrapExchangeRates(Connection conn) throws SQLException {
        String sql = """
            INSERT INTO core.exchange_rate (from_currency_code, to_currency_code, rate, effective_from)
            VALUES (?, ?, ?, '2024-01-01')
            ON CONFLICT DO NOTHING
            """;
        // CHECK constraint: from_currency_code < to_currency_code
        String[][] rates = {
                {"USD", "VND", "24500.00"},  // 1 USD = 24,500 VND
                {"EUR", "VND", "26800.00"},  // 1 EUR = 26,800 VND
                {"JPY", "VND", "165.00"},    // 1 JPY = 165 VND
        };
        for (String[] r : rates) {
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setString(1, r[0]);
                ps.setString(2, r[1]);
                ps.setBigDecimal(3, new java.math.BigDecimal(r[2]));
                ps.executeUpdate();
            }
        }
    }
}
