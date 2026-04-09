package com.fern.simulator.persistence;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.sql.*;
import java.time.Instant;
import java.time.OffsetDateTime;

/**
 * CRUD operations for {@code core.simulator_run}.
 */
public final class SimulatorRunRepository {

    private static final Logger log = LoggerFactory.getLogger(SimulatorRunRepository.class);
    private static final ObjectMapper JSON = new ObjectMapper()
            .registerModule(new JavaTimeModule())
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);

    private SimulatorRunRepository() {}

    public static void insertRun(Connection conn, String id, String namespace,
                                  String scenarioJson, int totalDays) throws SQLException {
        String sql = """
            INSERT INTO core.simulator_run (id, namespace, status, scenario_json, started_at, total_days, completed_days)
            VALUES (?, ?, 'running', ?, NOW(), ?, 0)
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, id);
            ps.setString(2, namespace);
            ps.setString(3, scenarioJson);
            ps.setInt(4, totalDays);
            ps.executeUpdate();
        }
        log.info("Created simulator_run: id={}, namespace={}", id, namespace);
    }

    public static void updateProgress(Connection conn, String id, int completedDays,
                                       String progressJson) throws SQLException {
        String sql = """
            UPDATE core.simulator_run
            SET completed_days = ?, progress_json = ?
            WHERE id = ?
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setInt(1, completedDays);
            ps.setString(2, progressJson);
            ps.setString(3, id);
            ps.executeUpdate();
        }
    }

    public static void completeRun(Connection conn, String id, int completedDays, String resultJson) throws SQLException {
        String sql = """
            UPDATE core.simulator_run
            SET status = 'complete', completed_days = ?, completed_at = NOW(), result_json = ?
            WHERE id = ?
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setInt(1, completedDays);
            ps.setString(2, resultJson);
            ps.setString(3, id);
            ps.executeUpdate();
        }
        log.info("Completed simulator_run: id={}", id);
    }

    public static void errorRun(Connection conn, String id, String errorMessage) throws SQLException {
        String sql = """
            UPDATE core.simulator_run
            SET status = 'error', completed_at = NOW(), error_message = ?
            WHERE id = ?
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, errorMessage);
            ps.setString(2, id);
            ps.executeUpdate();
        }
        log.warn("Error simulator_run: id={}, error={}", id, errorMessage);
    }

    /**
     * Reads a simulator_run by ID. Returns null if not found.
     */
    public static RunRecord findById(Connection conn, String id) throws SQLException {
        String sql = "SELECT * FROM core.simulator_run WHERE id = ?";
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, id);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    return new RunRecord(
                            rs.getString("id"),
                            rs.getString("namespace"),
                            rs.getString("status"),
                            rs.getString("scenario_json"),
                            rs.getInt("total_days"),
                            rs.getInt("completed_days"),
                            rs.getString("result_json"),
                            rs.getString("progress_json"),
                            rs.getString("error_message")
                    );
                }
            }
        }
        return null;
    }

    public record RunRecord(
            String id, String namespace, String status, String scenarioJson,
            int totalDays, int completedDays, String resultJson,
            String progressJson, String errorMessage
    ) {}
}
