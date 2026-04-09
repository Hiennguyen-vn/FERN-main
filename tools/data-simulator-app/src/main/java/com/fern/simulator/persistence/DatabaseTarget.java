package com.fern.simulator.persistence;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.Properties;

/**
 * Immutable JDBC connection target for the simulator.
 */
public record DatabaseTarget(
        String url,
        String username,
        String password
) {
    /**
     * Extracts the hostname from the JDBC URL for safety checks.
     */
    public String hostname() {
        // jdbc:postgresql://hostname:port/dbname
        String stripped = url.replace("jdbc:postgresql://", "");
        int colonOrSlash = stripped.indexOf(':');
        if (colonOrSlash < 0) colonOrSlash = stripped.indexOf('/');
        if (colonOrSlash < 0) return stripped;
        return stripped.substring(0, colonOrSlash);
    }

    /**
     * Opens a JDBC connection to the target database.
     */
    public Connection getConnection() throws SQLException {
        try {
            Class.forName("org.postgresql.Driver");
        } catch (ClassNotFoundException e) {
            throw new SQLException("PostgreSQL JDBC driver is not available", e);
        }
        Properties properties = new Properties();
        properties.setProperty("user", username);
        properties.setProperty("password", password);
        properties.setProperty("reWriteBatchedInserts", "true");
        properties.setProperty("ApplicationName", "FERN Data Simulator");
        return DriverManager.getConnection(url, properties);
    }
}
