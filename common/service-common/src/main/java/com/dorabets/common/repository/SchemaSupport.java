package com.dorabets.common.repository;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

public final class SchemaSupport {

    private SchemaSupport() {
    }

    public static boolean columnExists(Connection conn, String tableName, String columnName) throws SQLException {
        String sql = """
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = current_schema()
                  AND table_name = ?
                  AND column_name = ?
                """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, tableName);
            ps.setString(2, columnName);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next();
            }
        }
    }

    public static boolean constraintExists(Connection conn, String tableName, String constraintName) throws SQLException {
        String sql = """
                SELECT 1
                FROM information_schema.table_constraints
                WHERE table_schema = current_schema()
                  AND table_name = ?
                  AND constraint_name = ?
                """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, tableName);
            ps.setString(2, constraintName);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next();
            }
        }
    }
}
