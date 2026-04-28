package com.fern.common.test;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.sql.Connection;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.extension.AfterAllCallback;
import org.junit.jupiter.api.extension.BeforeAllCallback;
import org.junit.jupiter.api.extension.ExtensionContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * JUnit 5 extension that boots a single Postgres 16 container per JVM, runs Flyway migrations,
 * and exposes a HikariDataSource through {@link #dataSource()}.
 *
 * <p>Reuse pattern: container is started lazily on first beforeAll, kept alive until JVM exit.
 * Migrations resolved from repo root: {@code db/migrations}. Schema is wiped (drop + recreate)
 * before each test class via {@code clean()} so test classes are independent.
 *
 * <p>Usage:
 * <pre>
 * &#64;ExtendWith(PostgresContainerExtension.class)
 * class MyRepositoryIT {
 *   private final DataSource ds = PostgresContainerExtension.dataSource();
 * }
 * </pre>
 */
public class PostgresContainerExtension implements BeforeAllCallback, AfterAllCallback {

  private static final Logger log = LoggerFactory.getLogger(PostgresContainerExtension.class);
  private static final String IMAGE = "postgres:16-alpine";

  private static volatile PostgreSQLContainer<?> container;
  private static volatile HikariDataSource dataSource;
  private static volatile Flyway flyway;

  public static synchronized DataSource dataSource() {
    ensureStarted();
    return dataSource;
  }

  public static synchronized String jdbcUrl() {
    ensureStarted();
    return container.getJdbcUrl();
  }

  public static synchronized String username() {
    ensureStarted();
    return container.getUsername();
  }

  public static synchronized String password() {
    ensureStarted();
    return container.getPassword();
  }

  @Override
  public void beforeAll(ExtensionContext context) {
    ensureStarted();
    dataSource.getHikariPoolMXBean().softEvictConnections();
    flyway.clean();
    flyway.migrate();
  }

  @Override
  public void afterAll(ExtensionContext context) {
    // No-op: container reused across classes for speed.
  }

  private static synchronized void ensureStarted() {
    if (container != null) {
      return;
    }
    container = new PostgreSQLContainer<>(DockerImageName.parse(IMAGE))
        .withDatabaseName("fern_test")
        .withUsername("fern")
        .withPassword("fern")
        .withReuse(true);
    container.start();

    HikariConfig hc = new HikariConfig();
    hc.setJdbcUrl(withPostgresTestOptions(container.getJdbcUrl()));
    hc.setUsername(container.getUsername());
    hc.setPassword(container.getPassword());
    hc.setMaximumPoolSize(8);
    hc.setPoolName("fern-it-pool");
    dataSource = new HikariDataSource(hc);

    try (Connection conn = dataSource.getConnection();
         var st = conn.createStatement()) {
      st.execute("CREATE SCHEMA IF NOT EXISTS core");
      st.execute("ALTER DATABASE " + container.getDatabaseName() + " SET search_path TO core, public");
    } catch (Exception ex) {
      throw new IllegalStateException("Failed to set search_path", ex);
    }

    boolean partmanAvailable = false;
    try (Connection conn = dataSource.getConnection();
         var st = conn.createStatement()) {
      st.execute("CREATE SCHEMA IF NOT EXISTS partman");
      try (var rs = st.executeQuery(
          "SELECT 1 FROM pg_available_extensions WHERE name = 'pg_partman'")) {
        partmanAvailable = rs.next();
      }
      if (partmanAvailable) {
        st.execute("CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman");
      }
    } catch (Exception ex) {
      throw new IllegalStateException("Failed to prepare partman schema", ex);
    }
    if (!partmanAvailable) {
      try (Connection conn = dataSource.getConnection();
           var st = conn.createStatement()) {
        // The plain postgres test image does not ship pg_partman. Keep migration coverage by
        // installing a tiny compatibility shim for the partman calls used by repo migrations.
        installPartmanShim(st);
      } catch (Exception ex) {
        throw new IllegalStateException("Failed to install partman test shim", ex);
      }
    }

    Path migrations = locateMigrations();
    String target = System.getProperty("test.flyway.target", "").trim();
    var flywayConfig = Flyway.configure()
        .dataSource(dataSource)
        .locations("filesystem:" + migrations.toAbsolutePath())
        .schemas("core")
        .defaultSchema("core")
        .cleanDisabled(false);
    if (!target.isBlank()) {
      flywayConfig.target(target);
    }
    flyway = flywayConfig.load();

    log.info("Postgres test container ready: url={} migrations={}", container.getJdbcUrl(), migrations);
    Runtime.getRuntime().addShutdownHook(new Thread(PostgresContainerExtension::shutdown));
  }

  private static String withPostgresTestOptions(String jdbcUrl) {
    String separator = jdbcUrl.contains("?") ? "&" : "?";
    return jdbcUrl + separator + "prepareThreshold=0";
  }

  private static void installPartmanShim(java.sql.Statement st) throws Exception {
    st.execute(
        """
        CREATE TABLE IF NOT EXISTS partman.part_config (
          parent_table TEXT PRIMARY KEY,
          retention TEXT,
          retention_keep_table BOOLEAN,
          infinite_time_partitions BOOLEAN,
          automatic_maintenance TEXT,
          ignore_default_data BOOLEAN
        )
        """);
    st.execute(
        """
        CREATE OR REPLACE FUNCTION partman.create_parent(
          p_parent_table TEXT,
          p_control TEXT,
          p_type TEXT,
          p_interval TEXT,
          p_premake INTEGER DEFAULT NULL,
          p_start_partition TEXT DEFAULT NULL,
          p_default_table BOOLEAN DEFAULT NULL
        )
        RETURNS BOOLEAN
        LANGUAGE plpgsql
        AS $$
        BEGIN
          INSERT INTO partman.part_config(parent_table)
          VALUES (p_parent_table)
          ON CONFLICT (parent_table) DO NOTHING;
          RETURN TRUE;
        END;
        $$
        """);
  }

  private static Path locateMigrations() {
    Path current = Paths.get("").toAbsolutePath();
    while (current != null) {
      Path candidate = current.resolve("db/migrations");
      if (Files.isDirectory(candidate)) {
        return candidate;
      }
      current = current.getParent();
    }
    throw new IllegalStateException("Could not locate db/migrations from working directory");
  }

  private static synchronized void shutdown() {
    try {
      if (dataSource != null) {
        dataSource.close();
      }
    } catch (Exception ignored) {
    }
    try {
      if (container != null) {
        container.stop();
      }
    } catch (Exception ignored) {
    }
  }
}
