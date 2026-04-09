package com.fern.simulator.export;

import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.LocalDate;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class UserExporterTest {

    @Test
    void fetchByNamespaceReadsDbBackedAccountRows() throws Exception {
        Connection conn = mock(Connection.class);
        PreparedStatement ps = mock(PreparedStatement.class);
        ResultSet rs = mock(ResultSet.class);
        when(conn.prepareStatement(anyString())).thenReturn(ps);
        when(ps.executeQuery()).thenReturn(rs);
        when(rs.next()).thenReturn(true, false);
        when(rs.getString("namespace")).thenReturn("SIM-SMALL");
        when(rs.getLong("user_id")).thenReturn(101L);
        when(rs.getString("username")).thenReturn("sim_small_emp_0001");
        when(rs.getString("full_name")).thenReturn("Nguyen Van Former");
        when(rs.getString("employee_code")).thenReturn("SIM-SMALL-EMP-0001");
        when(rs.getString("user_status")).thenReturn("inactive");
        when(rs.getString("role")).thenReturn("none");
        when(rs.getString("contract_status")).thenReturn("terminated");
        when(rs.getString("employment_type")).thenReturn("full_time");
        when(rs.getString("salary_type")).thenReturn("monthly");
        when(rs.getString("currency_code")).thenReturn("VND");
        when(rs.getString("region_code")).thenReturn("VN");
        when(rs.getObject("hire_date", LocalDate.class)).thenReturn(LocalDate.of(2024, 1, 1));
        when(rs.getObject("end_date", LocalDate.class)).thenReturn(LocalDate.of(2024, 3, 1));
        when(rs.getString("created_at")).thenReturn("2024-01-01T08:00:00Z");
        when(rs.getString("outlet_code")).thenReturn("");
        when(rs.getString("outlet_name")).thenReturn("");

        List<UserExporter.AccountExportRow> rows = UserExporter.fetchByNamespace(conn, "SIM-SMALL");

        assertEquals(1, rows.size());
        assertEquals("SIM-SMALL", rows.getFirst().namespace());
        assertEquals("inactive", rows.getFirst().userStatus());
        assertEquals("terminated", rows.getFirst().contractStatus());
    }

    @Test
    void writeCsvIncludesAllAccountStates() throws Exception {
        List<UserExporter.AccountExportRow> rows = List.of(
                new UserExporter.AccountExportRow(
                        "SIM-SMALL", 101L, "sim_small_emp_0001", "Nguyen Van Former",
                        "SIM-SMALL-EMP-0001", "inactive", "none", "terminated",
                        "full_time", "monthly", "VND", "VN", LocalDate.of(2024, 1, 1),
                        LocalDate.of(2024, 3, 1), "2024-01-01T08:00:00Z", "", ""
                )
        );

        ByteArrayOutputStream output = new ByteArrayOutputStream();
        UserExporter.writeCsv(rows, output);
        String csv = output.toString(StandardCharsets.UTF_8);

        assertTrue(csv.contains("SIM-SMALL-EMP-0001"));
        assertTrue(csv.contains("\"inactive\""));
        assertTrue(csv.contains("\"terminated\""));
    }
}
