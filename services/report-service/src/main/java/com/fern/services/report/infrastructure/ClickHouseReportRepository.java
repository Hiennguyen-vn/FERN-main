package com.fern.services.report.infrastructure;

import com.fern.services.report.api.ReportDtos;
import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import javax.sql.DataSource;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Repository;

/**
 * ClickHouse-backed reporting queries. Currently scopes to dailyPnl as proof-of-concept.
 * Other queries fall through to ReportRepository (Postgres) until projections proven stable.
 */
@Repository
@ConditionalOnProperty(name = "report.clickhouse.enabled", havingValue = "true")
public class ClickHouseReportRepository {

  private final DataSource clickHouseDataSource;

  public ClickHouseReportRepository(@Qualifier("clickHouseDataSource") DataSource clickHouseDataSource) {
    this.clickHouseDataSource = clickHouseDataSource;
  }

  public List<ReportDtos.DailyPnl> dailyPnl(long outletId, LocalDate startDate, LocalDate endDate) {
    String sql = """
        SELECT businessDate AS business_date,
               sum(totalAmount) AS sales_total,
               0 AS expense_total
        FROM fern.events_sale_completed
        WHERE outletId = ?
          AND businessDate BETWEEN ? AND ?
        GROUP BY businessDate
        ORDER BY businessDate
        """;
    try (Connection c = clickHouseDataSource.getConnection();
         PreparedStatement ps = c.prepareStatement(sql)) {
      ps.setLong(1, outletId);
      ps.setObject(2, startDate);
      ps.setObject(3, endDate);
      try (ResultSet rs = ps.executeQuery()) {
        List<ReportDtos.DailyPnl> rows = new ArrayList<>();
        while (rs.next()) {
          BigDecimal sales = rs.getBigDecimal("sales_total");
          BigDecimal expense = rs.getBigDecimal("expense_total");
          BigDecimal sNN = sales == null ? BigDecimal.ZERO : sales;
          BigDecimal eNN = expense == null ? BigDecimal.ZERO : expense;
          rows.add(new ReportDtos.DailyPnl(
              outletId,
              rs.getDate("business_date").toLocalDate(),
              sNN,
              eNN,
              sNN.subtract(eNN)
          ));
        }
        return rows;
      }
    } catch (SQLException e) {
      throw new IllegalStateException("ClickHouse dailyPnl query failed", e);
    }
  }

  public List<ReportDtos.SalesSummary> salesSummary(long outletId, LocalDate startDate, LocalDate endDate) {
    String sql = """
        SELECT outletId, businessDate,
               count() AS sale_count,
               sum(totalAmount) AS subtotal,
               toDecimal128(0, 2) AS discount,
               toDecimal128(0, 2) AS tax_amount,
               sum(totalAmount) AS total_amount
        FROM fern.events_sale_completed
        WHERE outletId = ?
          AND businessDate BETWEEN ? AND ?
        GROUP BY outletId, businessDate
        ORDER BY businessDate
        """;
    try (Connection c = clickHouseDataSource.getConnection();
         PreparedStatement ps = c.prepareStatement(sql)) {
      ps.setLong(1, outletId);
      ps.setObject(2, startDate);
      ps.setObject(3, endDate);
      try (ResultSet rs = ps.executeQuery()) {
        List<ReportDtos.SalesSummary> rows = new ArrayList<>();
        while (rs.next()) {
          rows.add(new ReportDtos.SalesSummary(
              rs.getLong("outletId"),
              rs.getDate("businessDate").toLocalDate(),
              rs.getLong("sale_count"),
              nz(rs.getBigDecimal("subtotal")),
              nz(rs.getBigDecimal("discount")),
              nz(rs.getBigDecimal("tax_amount")),
              nz(rs.getBigDecimal("total_amount"))
          ));
        }
        return rows;
      }
    } catch (SQLException e) {
      throw new IllegalStateException("ClickHouse salesSummary query failed", e);
    }
  }

  public List<ReportDtos.TopSku> topSkus(long outletId, LocalDate startDate, LocalDate endDate, int limit) {
    String sql = """
        SELECT fs.outlet_id AS outlet_id,
               fs.product_id AS product_id,
               anyLast(fs.product_name) AS product_name,
               sum(fs.qty) AS total_quantity,
               sum(fs.line_total) AS total_revenue
        FROM fern.fact_sale fs
        WHERE fs.outlet_id = ?
          AND fs.business_date BETWEEN ? AND ?
        GROUP BY fs.outlet_id, fs.product_id
        ORDER BY total_revenue DESC
        LIMIT ?
        """;
    try (Connection c = clickHouseDataSource.getConnection();
         PreparedStatement ps = c.prepareStatement(sql)) {
      ps.setLong(1, outletId);
      ps.setObject(2, startDate);
      ps.setObject(3, endDate);
      ps.setInt(4, limit);
      try (ResultSet rs = ps.executeQuery()) {
        List<ReportDtos.TopSku> rows = new ArrayList<>();
        while (rs.next()) {
          rows.add(new ReportDtos.TopSku(
              rs.getLong("outlet_id"),
              rs.getLong("product_id"),
              null,
              rs.getString("product_name"),
              nz(rs.getBigDecimal("total_quantity")),
              nz(rs.getBigDecimal("total_revenue"))
          ));
        }
        return rows;
      }
    } catch (SQLException e) {
      throw new IllegalStateException("ClickHouse topSkus query failed", e);
    }
  }

  public com.fern.common.spring.web.PagedResult<ReportDtos.SalesSummary> salesSummaryPaged(
      long outletId, LocalDate startDate, LocalDate endDate, int limit, int offset) {
    String sql = """
        SELECT outletId, businessDate,
               count() AS sale_count,
               sum(totalAmount) AS subtotal,
               toDecimal128(0, 2) AS discount,
               toDecimal128(0, 2) AS tax_amount,
               sum(totalAmount) AS total_amount,
               count() OVER () AS total_count
        FROM fern.events_sale_completed
        WHERE outletId = ?
          AND businessDate BETWEEN ? AND ?
        GROUP BY outletId, businessDate
        ORDER BY businessDate
        LIMIT ? OFFSET ?
        """;
    try (Connection c = clickHouseDataSource.getConnection();
         PreparedStatement ps = c.prepareStatement(sql)) {
      ps.setLong(1, outletId);
      ps.setObject(2, startDate);
      ps.setObject(3, endDate);
      ps.setInt(4, limit);
      ps.setInt(5, offset);
      try (ResultSet rs = ps.executeQuery()) {
        List<ReportDtos.SalesSummary> rows = new ArrayList<>();
        long totalCount = 0;
        while (rs.next()) {
          totalCount = rs.getLong("total_count");
          rows.add(new ReportDtos.SalesSummary(
              rs.getLong("outletId"),
              rs.getDate("businessDate").toLocalDate(),
              rs.getLong("sale_count"),
              nz(rs.getBigDecimal("subtotal")),
              nz(rs.getBigDecimal("discount")),
              nz(rs.getBigDecimal("tax_amount")),
              nz(rs.getBigDecimal("total_amount"))
          ));
        }
        return com.fern.common.spring.web.PagedResult.of(rows, limit, offset, totalCount);
      }
    } catch (SQLException e) {
      throw new IllegalStateException("ClickHouse salesSummaryPaged query failed", e);
    }
  }

  public List<ReportDtos.CrossOutletCompare> crossOutletCompare(long regionId, LocalDate startDate, LocalDate endDate) {
    String sql = """
        SELECT do_.region_id AS region_id,
               es.outletId AS outlet_id,
               anyLast(do_.name) AS outlet_name,
               sum(es.totalAmount) AS sales_total,
               count() AS sale_count,
               if(count() = 0, toDecimal128(0, 2),
                  toDecimal128(sum(es.totalAmount) / count(), 2)) AS avg_ticket
        FROM fern.events_sale_completed es
        JOIN fern.dim_outlet do_ ON do_.outlet_id = es.outletId
        WHERE do_.region_id = ?
          AND es.businessDate BETWEEN ? AND ?
        GROUP BY do_.region_id, es.outletId
        ORDER BY sales_total DESC
        """;
    try (Connection c = clickHouseDataSource.getConnection();
         PreparedStatement ps = c.prepareStatement(sql)) {
      ps.setLong(1, regionId);
      ps.setObject(2, startDate);
      ps.setObject(3, endDate);
      try (ResultSet rs = ps.executeQuery()) {
        List<ReportDtos.CrossOutletCompare> rows = new ArrayList<>();
        while (rs.next()) {
          rows.add(new ReportDtos.CrossOutletCompare(
              rs.getLong("region_id"),
              rs.getLong("outlet_id"),
              null,
              rs.getString("outlet_name"),
              nz(rs.getBigDecimal("sales_total")),
              rs.getLong("sale_count"),
              nz(rs.getBigDecimal("avg_ticket"))
          ));
        }
        return rows;
      }
    } catch (SQLException e) {
      throw new IllegalStateException("ClickHouse crossOutletCompare query failed", e);
    }
  }

  private static BigDecimal nz(BigDecimal v) {
    return v == null ? BigDecimal.ZERO : v;
  }
}
