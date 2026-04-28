package com.fern.common.test;

import java.sql.Connection;
import java.sql.SQLException;
import javax.sql.DataSource;

/**
 * Seeds standard reference data into the test Postgres container. Idempotent — safe to call
 * once per test class. Provides canonical IDs that integration tests can reference.
 *
 * <p>Standard tenants:
 * <ul>
 *   <li>Region 100 = VN-HCM, outlets 10, 11</li>
 *   <li>Region 200 = US-NY, outlets 20, 21</li>
 *   <li>Users: 1 system-admin (id=1), 2 outlet-manager-hcm (id=2), 3 outlet-manager-ny (id=3)</li>
 * </ul>
 *
 * <p>Concrete SQL kept minimal here; extend in service-specific {@code TestSeed} classes
 * to add domain rows (items, customers, payment methods).
 */
public final class TestFixtures {

  public static final long REGION_HCM = 100L;
  public static final long REGION_NY = 200L;
  public static final long OUTLET_HCM_1 = 10L;
  public static final long OUTLET_HCM_2 = 11L;
  public static final long OUTLET_NY_1 = 20L;
  public static final long OUTLET_NY_2 = 21L;
  public static final long USER_SYSTEM_ADMIN = 1L;
  public static final long USER_MANAGER_HCM = 2L;
  public static final long USER_MANAGER_NY = 3L;

  private TestFixtures() {
  }

  public static void seedBaseline(DataSource dataSource) {
    try (Connection conn = dataSource.getConnection()) {
      conn.setAutoCommit(false);
      try (var st = conn.createStatement()) {
        st.execute("SET search_path TO core, public");
        st.execute("""
            INSERT INTO core.currency (code, name, decimal_places)
            VALUES ('USD', 'US Dollar', 2)
            ON CONFLICT (code) DO NOTHING
            """);
        st.execute("""
            INSERT INTO core.region (id, code, name, parent_region_id, currency_code, timezone_name)
            VALUES
              (100, 'VN-HCM', 'Ho Chi Minh', NULL, 'USD', 'Asia/Ho_Chi_Minh'),
              (200, 'US-NY',  'New York',     NULL, 'USD', 'America/New_York')
            ON CONFLICT (id) DO NOTHING
            """);
        st.execute("""
            INSERT INTO core.outlet (id, code, name, region_id, status, opened_at)
            VALUES
              (10, 'HCM-D1', 'HCM District 1', 100, 'active', '2026-01-01'),
              (11, 'HCM-D2', 'HCM District 2', 100, 'active', '2026-01-01'),
              (20, 'NY-MAN', 'NY Manhattan',   200, 'active', '2026-01-01'),
              (21, 'NY-BRK', 'NY Brooklyn',    200, 'active', '2026-01-01')
            ON CONFLICT (id) DO NOTHING
            """);
        st.execute("""
            INSERT INTO core.app_user (id, username, password_hash, full_name, employee_code, email, status)
            VALUES
              (1, 'system-admin', '$2a$10$testhash', 'System Admin', 'SYS-001', 'system-admin@test.local', 'active'),
              (2, 'outlet-manager-hcm', '$2a$10$testhash', 'HCM Outlet Manager', 'HCM-001', 'manager-hcm@test.local', 'active'),
              (3, 'outlet-manager-ny', '$2a$10$testhash', 'NY Outlet Manager', 'NY-001', 'manager-ny@test.local', 'active')
            ON CONFLICT (id) DO NOTHING
            """);
      }
      conn.commit();
    } catch (SQLException e) {
      throw new IllegalStateException("Failed to seed baseline test fixtures", e);
    }
  }

  public static void truncateAll(DataSource dataSource, String... tables) {
    try (Connection conn = dataSource.getConnection();
         var st = conn.createStatement()) {
      for (String table : tables) {
        st.execute("TRUNCATE TABLE " + table + " CASCADE");
      }
    } catch (SQLException e) {
      throw new IllegalStateException("Failed to truncate test tables", e);
    }
  }
}
