package com.fern.services.sales.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.io.PrintWriter;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.SQLFeatureNotSupportedException;
import java.util.logging.Logger;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;

class PosMetricsTest {

  @Test
  void gaugesReadDatabaseValuesAndCountersRecordEvents() throws Exception {
    SimpleMeterRegistry registry = new SimpleMeterRegistry();
    PosMetrics metrics = new PosMetrics(registry, dataSourceWithMetricRows());

    metrics.registerMetrics();

    assertEquals(7.0, invokeMetric(metrics, "outboxPendingDepth"));
    assertEquals(12.0, invokeMetric(metrics, "outboxPublishLagSeconds"));
    assertEquals(2.0, invokeMetric(metrics, "outboxFailedDepth"));
    assertEquals(1.0, invokeMetric(metrics, "outboxDlqPendingDepth"));
    assertEquals(30.0, invokeMetric(metrics, "outboxDlqOldestAgeSeconds"));
    assertEquals(3.0, invokeMetric(metrics, "inventoryNegativeBalance"));
    assertEquals(4.0, invokeMetric(metrics, "oversell24h"));
    assertEquals(600.0, invokeMetric(metrics, "offlineDurationMax"));
    assertTrue(invokeMetric(metrics, "deviceLastSeenLagSeconds") >= 0.0);
    assertEquals(0.25, metrics.wasteRate24h(), 0.0001);
    assertEquals(5000.0, metrics.shiftVarianceAbsMax(), 0.0001);

    metrics.incrementOutboxPublished();
    metrics.incrementOutboxFailed();
    metrics.recordSyncPushEvent("sale", "accepted");
    metrics.recordSyncPushDuration("sale", () -> {
    });
    metrics.orderCompletionTimer().record(() -> {
    });
    metrics.recordPaymentStateTransition("pending", "paid");

    assertEquals(1.0, registry.get("outbox_publish_rate_total").tag("status", "published").counter().count());
    assertEquals(1.0, registry.get("outbox_publish_rate_total").tag("status", "failed").counter().count());
    assertEquals(1.0, registry.get("sync_push_events_total")
        .tag("event_type", "sale")
        .tag("outcome", "accepted")
        .counter()
        .count());
    assertEquals(1L, registry.get("sync_push_duration_seconds").tag("event_type", "sale").timer().count());
    assertEquals(1L, registry.get("pos_order_completion_seconds").timer().count());
    assertEquals(1.0, registry.get("payment_state_transitions_total")
        .tag("from_state", "pending")
        .tag("to_state", "paid")
        .counter()
        .count());
  }

  @Test
  void gaugesReturnZeroWhenDatabaseQueriesFail() throws Exception {
    DataSource dataSource = mock(DataSource.class);
    when(dataSource.getConnection()).thenThrow(new SQLException("database unavailable"));
    PosMetrics metrics = new PosMetrics(new SimpleMeterRegistry(), dataSource);

    assertEquals(0.0, metrics.wasteRate24h());
    assertEquals(0.0, metrics.shiftVarianceAbsMax());
  }

  private double invokeMetric(PosMetrics metrics, String methodName) throws Exception {
    Method method = PosMetrics.class.getDeclaredMethod(methodName);
    method.setAccessible(true);
    return (double) method.invoke(metrics);
  }

  private DataSource dataSourceWithMetricRows() {
    return new DataSource() {
      @Override
      public Connection getConnection() {
        return connectionProxy();
      }

      @Override
      public Connection getConnection(String username, String password) {
        return connectionProxy();
      }

      @Override
      public PrintWriter getLogWriter() {
        return null;
      }

      @Override
      public void setLogWriter(PrintWriter out) {
      }

      @Override
      public void setLoginTimeout(int seconds) {
      }

      @Override
      public int getLoginTimeout() {
        return 0;
      }

      @Override
      public Logger getParentLogger() {
        return Logger.getGlobal();
      }

      @Override
      public <T> T unwrap(Class<T> iface) throws SQLException {
        throw new SQLFeatureNotSupportedException();
      }

      @Override
      public boolean isWrapperFor(Class<?> iface) {
        return false;
      }
    };
  }

  private Connection connectionProxy() {
    return proxy(Connection.class, (target, method, args) -> switch (method.getName()) {
      case "prepareStatement" -> preparedStatementProxy((String) args[0]);
      case "close" -> null;
      case "isClosed" -> false;
      default -> defaultValue(method.getReturnType());
    });
  }

  private PreparedStatement preparedStatementProxy(String sql) {
    return proxy(PreparedStatement.class, (target, method, args) -> switch (method.getName()) {
      case "executeQuery" -> resultSetProxy(sql);
      case "close" -> null;
      default -> defaultValue(method.getReturnType());
    });
  }

  private ResultSet resultSetProxy(String sql) {
    return proxy(ResultSet.class, (target, method, args) -> switch (method.getName()) {
      case "next" -> true;
      case "wasNull" -> false;
      case "getLong" -> longValueFor(sql);
      case "getDouble" -> doubleValueFor(sql, args == null ? null : args[0]);
      case "close" -> null;
      default -> defaultValue(method.getReturnType());
    });
  }

  private long longValueFor(String sql) {
    if (sql.contains("dlq_status='PENDING'")) {
      return 1L;
    }
    if (sql.contains("status='PENDING'")) {
      return 7L;
    }
    if (sql.contains("status='FAILED'")) {
      return 2L;
    }
    if (sql.contains("stock_balance")) {
      return 3L;
    }
    if (sql.contains("oversell_flag")) {
      return 4L;
    }
    return 0L;
  }

  private double doubleValueFor(String sql, Object column) {
    if ("waste_qty".equals(column)) {
      return 2.0;
    }
    if ("sale_qty".equals(column)) {
      return 6.0;
    }
    if (sql.contains("pos_session_reconciliation")) {
      return 5000.0;
    }
    if (sql.contains("dlq_status='PENDING'") && sql.contains("MIN(created_at)")) {
      return 30.0;
    }
    if (sql.contains("status='PENDING'") && sql.contains("MIN(created_at)")) {
      return 12.0;
    }
    if (sql.contains("MAX(EXTRACT")) {
      return 600.0;
    }
    if (sql.contains("MIN(last_seen_at)")) {
      return 45.0;
    }
    return longValueFor(sql);
  }

  @SuppressWarnings("unchecked")
  private <T> T proxy(Class<T> type, InvocationHandler handler) {
    return (T) Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[] {type}, handler);
  }

  private Object defaultValue(Class<?> returnType) {
    if (!returnType.isPrimitive()) {
      return null;
    }
    if (returnType == boolean.class) {
      return false;
    }
    if (returnType == byte.class) {
      return (byte) 0;
    }
    if (returnType == short.class) {
      return (short) 0;
    }
    if (returnType == int.class) {
      return 0;
    }
    if (returnType == long.class) {
      return 0L;
    }
    if (returnType == float.class) {
      return 0.0f;
    }
    if (returnType == double.class) {
      return 0.0d;
    }
    if (returnType == char.class) {
      return '\0';
    }
    return null;
  }
}
