package com.fern.simulator.export;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.BufferedWriter;
import java.io.IOException;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/**
 * Exports simulator-owned accounts directly from the database.
 */
public final class UserExporter {

    private static final Logger log = LoggerFactory.getLogger(UserExporter.class);

    private UserExporter() {}

    public static List<AccountExportRow> fetchByNamespace(Connection conn, String namespace) throws SQLException {
        return fetch(conn, "namespace", namespace);
    }

    public static List<AccountExportRow> fetchAll(Connection conn) throws SQLException {
        return fetch(conn, "all", null);
    }

    public static void exportCsv(List<AccountExportRow> accounts, Path outputPath) throws IOException {
        if (outputPath.getParent() != null) {
            Files.createDirectories(outputPath.getParent());
        }
        try (BufferedWriter writer = Files.newBufferedWriter(outputPath, StandardCharsets.UTF_8)) {
            writeCsv(accounts, writer);
        }
        log.info("Exported {} simulator accounts to {}", accounts.size(), outputPath);
    }

    public static void writeCsv(List<AccountExportRow> accounts, OutputStream outputStream) throws IOException {
        try (BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(outputStream, StandardCharsets.UTF_8))) {
            writeCsv(accounts, writer);
            writer.flush();
        }
    }

    private static void writeCsv(List<AccountExportRow> accounts, BufferedWriter writer) throws IOException {
        writer.write(String.join(",",
                "namespace", "user_id", "username", "full_name", "employee_code", "user_status",
                "role", "contract_status", "employment_type", "salary_type", "currency_code",
                "region_code", "hire_date", "termination_date", "created_at", "outlet_code", "outlet_name"));
        writer.newLine();
        for (AccountExportRow row : accounts) {
            writer.write(String.join(",",
                    escape(row.namespace()),
                    String.valueOf(row.userId()),
                    escape(row.username()),
                    escape(row.fullName()),
                    escape(row.employeeCode()),
                    escape(row.userStatus()),
                    escape(row.role()),
                    escape(row.contractStatus()),
                    escape(row.employmentType()),
                    escape(row.salaryType()),
                    escape(row.currencyCode()),
                    escape(row.regionCode()),
                    escape(row.hireDate() != null ? row.hireDate().toString() : ""),
                    escape(row.terminationDate() != null ? row.terminationDate().toString() : ""),
                    escape(row.createdAt()),
                    escape(row.outletCode()),
                    escape(row.outletName())
            ));
            writer.newLine();
        }
    }

    private static List<AccountExportRow> fetch(Connection conn, String scope, String namespace) throws SQLException {
        String sql = """
                WITH owned_namespaces AS (
                    SELECT DISTINCT namespace
                    FROM core.simulator_run
                    WHERE namespace IS NOT NULL
                ),
                scoped_users AS (
                    SELECT n.namespace, u.id AS user_id, u.username, u.full_name, u.employee_code,
                           u.status::text AS user_status, u.created_at::text AS created_at
                    FROM owned_namespaces n
                    JOIN core.app_user u ON u.employee_code LIKE n.namespace || '%'
                    WHERE (? = 'all' OR n.namespace = ?)
                ),
                latest_contract AS (
                    SELECT DISTINCT ON (ec.user_id)
                           ec.user_id,
                           ec.status::text AS contract_status,
                           ec.employment_type::text AS employment_type,
                           ec.salary_type::text AS salary_type,
                           ec.currency_code,
                           ec.region_code,
                           ec.hire_date,
                           ec.end_date
                    FROM core.employee_contract ec
                    ORDER BY ec.user_id, ec.start_date DESC NULLS LAST, ec.created_at DESC NULLS LAST
                )
                SELECT su.namespace,
                       su.user_id,
                       su.username,
                       COALESCE(su.full_name, '') AS full_name,
                       su.employee_code,
                       su.user_status,
                       COALESCE(string_agg(DISTINCT COALESCE(r.name, ur.role_code), '; '), 'none') AS role,
                       COALESCE(lc.contract_status, 'none') AS contract_status,
                       COALESCE(lc.employment_type, '') AS employment_type,
                       COALESCE(lc.salary_type, '') AS salary_type,
                       COALESCE(lc.currency_code, '') AS currency_code,
                       COALESCE(lc.region_code, '') AS region_code,
                       lc.hire_date,
                       lc.end_date,
                       su.created_at,
                       COALESCE(string_agg(DISTINCT o.code, '; '), '') AS outlet_code,
                       COALESCE(string_agg(DISTINCT o.name, '; '), '') AS outlet_name
                FROM scoped_users su
                LEFT JOIN latest_contract lc ON lc.user_id = su.user_id
                LEFT JOIN core.user_role ur ON ur.user_id = su.user_id
                LEFT JOIN core.role r ON r.code = ur.role_code
                LEFT JOIN core.outlet o ON o.id = ur.outlet_id
                GROUP BY su.namespace, su.user_id, su.username, su.full_name, su.employee_code,
                         su.user_status, lc.contract_status, lc.employment_type, lc.salary_type,
                         lc.currency_code, lc.region_code, lc.hire_date, lc.end_date, su.created_at
                ORDER BY su.namespace, su.employee_code, su.username
                """;

        List<AccountExportRow> rows = new ArrayList<>();
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, scope);
            ps.setString(2, namespace);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    rows.add(new AccountExportRow(
                            rs.getString("namespace"),
                            rs.getLong("user_id"),
                            rs.getString("username"),
                            rs.getString("full_name"),
                            rs.getString("employee_code"),
                            rs.getString("user_status"),
                            rs.getString("role"),
                            rs.getString("contract_status"),
                            rs.getString("employment_type"),
                            rs.getString("salary_type"),
                            rs.getString("currency_code"),
                            rs.getString("region_code"),
                            rs.getObject("hire_date", LocalDate.class),
                            rs.getObject("end_date", LocalDate.class),
                            rs.getString("created_at"),
                            rs.getString("outlet_code"),
                            rs.getString("outlet_name")
                    ));
                }
            }
        }
        return rows;
    }

    private static String escape(String value) {
        String safe = value == null ? "" : value;
        return "\"" + safe.replace("\"", "\"\"") + "\"";
    }

    public record AccountExportRow(
            String namespace,
            long userId,
            String username,
            String fullName,
            String employeeCode,
            String userStatus,
            String role,
            String contractStatus,
            String employmentType,
            String salaryType,
            String currencyCode,
            String regionCode,
            LocalDate hireDate,
            LocalDate terminationDate,
            String createdAt,
            String outletCode,
            String outletName
    ) {}
}
