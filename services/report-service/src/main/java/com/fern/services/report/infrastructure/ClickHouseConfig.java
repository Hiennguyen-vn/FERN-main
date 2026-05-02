package com.fern.services.report.infrastructure;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import javax.sql.DataSource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * ClickHouse JDBC DataSource. Disabled by default — enable via report.clickhouse.enabled=true.
 * URL example: jdbc:ch://clickhouse:8123/fern
 */
@Configuration
@ConditionalOnProperty(name = "report.clickhouse.enabled", havingValue = "true")
public class ClickHouseConfig {

  @Bean(name = "clickHouseDataSource")
  public DataSource clickHouseDataSource(
      @Value("${report.clickhouse.url:jdbc:ch://clickhouse:8123/fern}") String url,
      @Value("${report.clickhouse.user:default}") String user,
      @Value("${report.clickhouse.password:}") String password
  ) {
    HikariConfig cfg = new HikariConfig();
    cfg.setJdbcUrl(url);
    cfg.setUsername(user);
    cfg.setPassword(password);
    cfg.setMaximumPoolSize(8);
    cfg.setPoolName("ch-report");
    return new HikariDataSource(cfg);
  }
}
