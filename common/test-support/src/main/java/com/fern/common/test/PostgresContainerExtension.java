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
    hc.setJdbcUrl(container.getJdbcUrl());
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

    try (Connection conn = dataSource.getConnection();
         var st = conn.createStatement()) {
      st.execute("CREATE SCHEMA IF NOT EXISTS partman");
      try {
        st.execute("CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman");
      } catch (Exception ignored) {
        // extension unavailable in plain postgres image — partition migrations will be skipped
      }
    } catch (Exception ex) {
      throw new IllegalStateException("Failed to prepare partman schema", ex);
    }

    Path migrations = locateMigrations();
    String target = System.getProperty("test.flyway.target", "26");
    flyway = Flyway.configure()
        .dataSource(dataSource)
        .locations("filesystem:" + migrations.toAbsolutePath())
        .schemas("core")
        .defaultSchema("core")
        .target(target)
        .cleanDisabled(false)
        .load();

    log.info("Postgres test container ready: url={} migrations={}", container.getJdbcUrl(), migrations);
    Runtime.getRuntime().addShutdownHook(new Thread(PostgresContainerExtension::shutdown));
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
