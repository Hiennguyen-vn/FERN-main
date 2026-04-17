package com.fern.services.org.infrastructure;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.repository.BaseRepository;
import com.fern.services.org.api.OrgDtos;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import javax.sql.DataSource;
import org.springframework.stereotype.Repository;

@Repository
public class OrgRepository extends BaseRepository {

  private final SnowflakeIdGenerator snowflakeIdGenerator;
  private final Clock clock;

  public OrgRepository(
      DataSource dataSource,
      SnowflakeIdGenerator snowflakeIdGenerator,
      Clock clock
  ) {
    super(dataSource);
    this.snowflakeIdGenerator = snowflakeIdGenerator;
    this.clock = clock;
  }

  public List<OrgDtos.RegionView> listRegions() {
    return queryList(
        """
        SELECT id, code, parent_region_id, currency_code, name, tax_code, timezone_name
        FROM core.region
        ORDER BY code
        """,
        this::mapRegion
    );
  }

  public String hierarchyVersionKey() {
    return queryOne(
        """
        SELECT CONCAT(
                 'hierarchy:',
                 COALESCE((SELECT FLOOR(EXTRACT(EPOCH FROM MAX(updated_at)) * 1000)::bigint::text FROM core.region), '0'),
                 ':',
                 COALESCE((
                   SELECT FLOOR(
                     EXTRACT(EPOCH FROM MAX(GREATEST(updated_at, COALESCE(deleted_at, updated_at)))) * 1000
                   )::bigint::text
                   FROM core.outlet
                 ), '0'),
                 ':',
                 (SELECT COUNT(*)::text FROM core.region),
                 ':',
                 (SELECT COUNT(*)::text FROM core.outlet WHERE deleted_at IS NULL)
               ) AS version_key
        """,
        rs -> {
          try {
            return rs.getString("version_key");
          } catch (java.sql.SQLException e) {
            throw new IllegalStateException("Unable to read org hierarchy version key", e);
          }
        }
    ).orElse("hierarchy:missing");
  }

  public Optional<OrgDtos.RegionView> findRegionByCode(String code) {
    return queryOne(
        """
        SELECT id, code, parent_region_id, currency_code, name, tax_code, timezone_name
        FROM core.region
        WHERE code = ?
        """,
        this::mapRegion,
        code
    );
  }

  public List<OrgDtos.OutletView> listOutlets(Long regionId) {
    if (regionId == null) {
      return queryList(
          """
          SELECT
            id,
            region_id,
            code,
            name,
            CASE WHEN deleted_at IS NOT NULL THEN 'archived' ELSE status::text END AS lifecycle_status,
            address,
            phone,
            email,
            opened_at,
            closed_at
          FROM core.outlet
          WHERE deleted_at IS NULL
          ORDER BY code
          """,
          this::mapOutlet
      );
    }
    return queryList(
        """
        SELECT
          id,
          region_id,
          code,
          name,
          CASE WHEN deleted_at IS NOT NULL THEN 'archived' ELSE status::text END AS lifecycle_status,
          address,
          phone,
          email,
          opened_at,
          closed_at
        FROM core.outlet
        WHERE deleted_at IS NULL AND region_id = ?
        ORDER BY code
        """,
        this::mapOutlet,
        regionId
    );
  }

  public Optional<OrgDtos.OutletView> findOutletById(long outletId) {
    return queryOne(
        """
        SELECT
          id,
          region_id,
          code,
          name,
          CASE WHEN deleted_at IS NOT NULL THEN 'archived' ELSE status::text END AS lifecycle_status,
          address,
          phone,
          email,
          opened_at,
          closed_at
        FROM core.outlet
        WHERE id = ? AND deleted_at IS NULL
        """,
        this::mapOutlet,
        outletId
    );
  }

  public Optional<OrgDtos.OutletView> findManagedOutletById(long outletId) {
    return queryOne(
        """
        SELECT
          id,
          region_id,
          code,
          name,
          CASE WHEN deleted_at IS NOT NULL THEN 'archived' ELSE status::text END AS lifecycle_status,
          address,
          phone,
          email,
          opened_at,
          closed_at
        FROM core.outlet
        WHERE id = ?
        """,
        this::mapOutlet,
        outletId
    );
  }

  public Optional<OrgDtos.ExchangeRateView> findExchangeRate(
      String fromCurrencyCode,
      String toCurrencyCode,
      LocalDate onDate
  ) {
    return queryOne(
        """
        SELECT from_currency_code, to_currency_code, rate, effective_from, effective_to, updated_at
        FROM core.exchange_rate
        WHERE from_currency_code = ?
          AND to_currency_code = ?
          AND effective_from <= ?
          AND (effective_to IS NULL OR effective_to >= ?)
        ORDER BY effective_from DESC
        LIMIT 1
        """,
        this::mapExchangeRate,
        fromCurrencyCode,
        toCurrencyCode,
        java.sql.Date.valueOf(onDate),
        java.sql.Date.valueOf(onDate)
    );
  }

  public OrgDtos.OutletView createOutlet(OrgDtos.CreateOutletRequest request) {
    return executeInTransaction(conn -> {
      if (!regionExists(conn, request.regionId())) {
        throw ServiceException.notFound("Region not found: " + request.regionId());
      }
      long outletId = snowflakeIdGenerator.generateId();
      Instant now = clock.instant();
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.outlet (
            id, region_id, code, name, status, address, phone, email, opened_at, closed_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?::location_status_enum, ?, ?, ?, ?, ?, ?, ?)
          """
      )) {
        ps.setLong(1, outletId);
        ps.setLong(2, request.regionId());
        ps.setString(3, request.code().trim());
        ps.setString(4, request.name().trim());
        ps.setString(5, normalizeStatus(request.status()));
        ps.setString(6, trimToNull(request.address()));
        ps.setString(7, trimToNull(request.phone()));
        ps.setString(8, trimToNull(request.email()));
        ps.setObject(9, request.openedAt());
        ps.setObject(10, request.closedAt());
        ps.setTimestamp(11, Timestamp.from(now));
        ps.setTimestamp(12, Timestamp.from(now));
        ps.executeUpdate();
      } catch (java.sql.SQLException e) {
        if ("23505".equals(e.getSQLState())) {
          throw ServiceException.conflict("Outlet code already exists");
        }
        throw e;
      }
      return findOutletByIdTransactional(conn, outletId, false)
          .orElseThrow(() -> new IllegalStateException("Created outlet not found: " + outletId));
    });
  }

  public OrgDtos.RegionView createRegion(OrgDtos.CreateRegionRequest request) {
    return executeInTransaction(conn -> {
      Long parentRegionId = request.parentRegionId();
      if (parentRegionId != null && !regionExists(conn, parentRegionId)) {
        throw ServiceException.notFound("Parent region not found: " + parentRegionId);
      }
      ensureCurrencyExists(conn, request.currencyCode());
      long regionId = snowflakeIdGenerator.generateId();
      Instant now = clock.instant();
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.region (
            id, code, parent_region_id, currency_code, name, tax_code, timezone_name, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          """
      )) {
        ps.setLong(1, regionId);
        ps.setString(2, request.code().trim());
        if (parentRegionId == null) {
          ps.setNull(3, java.sql.Types.BIGINT);
        } else {
          ps.setLong(3, parentRegionId);
        }
        ps.setString(4, request.currencyCode().trim());
        ps.setString(5, request.name().trim());
        ps.setString(6, trimToNull(request.taxCode()));
        ps.setString(7, request.timezoneName().trim());
        ps.setTimestamp(8, Timestamp.from(now));
        ps.setTimestamp(9, Timestamp.from(now));
        ps.executeUpdate();
      } catch (SQLException e) {
        if ("23505".equals(e.getSQLState())) {
          throw ServiceException.conflict("Region code already exists");
        }
        throw e;
      }
      return findRegionByIdTransactional(conn, regionId)
          .orElseThrow(() -> new IllegalStateException("Created region not found: " + regionId));
    });
  }

  public OrgDtos.RegionView updateRegion(long regionId, OrgDtos.UpdateRegionRequest request) {
    return executeInTransaction(conn -> {
      if (!regionExists(conn, regionId)) {
        throw ServiceException.notFound("Region not found: " + regionId);
      }
      Long parentRegionId = request.parentRegionId();
      if (parentRegionId != null && !regionExists(conn, parentRegionId)) {
        throw ServiceException.notFound("Parent region not found: " + parentRegionId);
      }
      ensureCurrencyExists(conn, request.currencyCode());
      try (PreparedStatement ps = conn.prepareStatement(
          """
          UPDATE core.region
          SET parent_region_id = ?,
              currency_code = ?,
              name = ?,
              tax_code = ?,
              timezone_name = ?,
              updated_at = ?
          WHERE id = ?
          """
      )) {
        if (parentRegionId == null) {
          ps.setNull(1, java.sql.Types.BIGINT);
        } else {
          ps.setLong(1, parentRegionId);
        }
        ps.setString(2, request.currencyCode().trim());
        ps.setString(3, request.name().trim());
        ps.setString(4, trimToNull(request.taxCode()));
        ps.setString(5, request.timezoneName().trim());
        ps.setTimestamp(6, Timestamp.from(clock.instant()));
        ps.setLong(7, regionId);
        if (ps.executeUpdate() == 0) {
          throw ServiceException.notFound("Region not found: " + regionId);
        }
      }
      return findRegionByIdTransactional(conn, regionId)
          .orElseThrow(() -> new IllegalStateException("Updated region not found: " + regionId));
    });
  }

  public OrgDtos.OutletView updateOutlet(long outletId, OrgDtos.UpdateOutletRequest request) {
    return executeInTransaction(conn -> {
      OrgDtos.OutletView existing = findOutletByIdTransactional(conn, outletId, true)
          .orElseThrow(() -> ServiceException.notFound("Outlet not found: " + outletId));
      if ("archived".equalsIgnoreCase(existing.status())) {
        throw ServiceException.conflict("Archived outlet cannot be updated");
      }
      try (PreparedStatement ps = conn.prepareStatement(
          """
          UPDATE core.outlet
          SET code = ?,
              name = ?,
              address = ?,
              phone = ?,
              email = ?,
              opened_at = ?,
              closed_at = ?,
              updated_at = ?
          WHERE id = ?
          """
      )) {
        ps.setString(1, request.code().trim());
        ps.setString(2, request.name().trim());
        ps.setString(3, trimToNull(request.address()));
        ps.setString(4, trimToNull(request.phone()));
        ps.setString(5, trimToNull(request.email()));
        ps.setObject(6, request.openedAt());
        ps.setObject(7, request.closedAt());
        ps.setTimestamp(8, Timestamp.from(clock.instant()));
        ps.setLong(9, outletId);
        ps.executeUpdate();
      } catch (SQLException e) {
        if ("23505".equals(e.getSQLState())) {
          throw ServiceException.conflict("Outlet code already exists");
        }
        throw e;
      }
      return findOutletByIdTransactional(conn, outletId, true)
          .orElseThrow(() -> new IllegalStateException("Updated outlet not found: " + outletId));
    });
  }

  public OrgDtos.OutletView updateOutletStatus(long outletId, String targetStatus) {
    return executeInTransaction(conn -> {
      OrgDtos.OutletView existing = findOutletByIdTransactional(conn, outletId, true)
          .orElseThrow(() -> ServiceException.notFound("Outlet not found: " + outletId));
      if ("archived".equalsIgnoreCase(existing.status())) {
        throw ServiceException.conflict("Archived outlet cannot change status");
      }
      Instant now = clock.instant();
      if ("archived".equalsIgnoreCase(targetStatus)) {
        try (PreparedStatement ps = conn.prepareStatement(
            """
            UPDATE core.outlet
            SET deleted_at = ?,
                updated_at = ?
            WHERE id = ?
            """
        )) {
          Timestamp timestamp = Timestamp.from(now);
          ps.setTimestamp(1, timestamp);
          ps.setTimestamp(2, timestamp);
          ps.setLong(3, outletId);
          ps.executeUpdate();
        }
      } else {
        try (PreparedStatement ps = conn.prepareStatement(
            """
            UPDATE core.outlet
            SET status = ?::location_status_enum,
                updated_at = ?
            WHERE id = ?
            """
        )) {
          ps.setString(1, normalizeStatus(targetStatus));
          ps.setTimestamp(2, Timestamp.from(now));
          ps.setLong(3, outletId);
          ps.executeUpdate();
        }
      }
      return findOutletByIdTransactional(conn, outletId, true)
          .orElseThrow(() -> new IllegalStateException("Updated outlet not found: " + outletId));
    });
  }

  public OrgDtos.ExchangeRateView upsertExchangeRate(OrgDtos.UpdateExchangeRateRequest request) {
    return executeInTransaction(conn -> {
      ensureCurrencyExists(conn, request.fromCurrencyCode());
      ensureCurrencyExists(conn, request.toCurrencyCode());
      Instant now = clock.instant();
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.exchange_rate (
            from_currency_code, to_currency_code, rate, effective_from, effective_to, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (from_currency_code, to_currency_code, effective_from)
          DO UPDATE SET
            rate = EXCLUDED.rate,
            effective_to = EXCLUDED.effective_to,
            updated_at = EXCLUDED.updated_at
          """
      )) {
        ps.setString(1, request.fromCurrencyCode().trim());
        ps.setString(2, request.toCurrencyCode().trim());
        ps.setBigDecimal(3, request.rate());
        ps.setObject(4, request.effectiveFrom());
        ps.setObject(5, request.effectiveTo());
        ps.setTimestamp(6, Timestamp.from(now));
        ps.setTimestamp(7, Timestamp.from(now));
        ps.executeUpdate();
      }
      return findExchangeRate(request.fromCurrencyCode(), request.toCurrencyCode(), request.effectiveFrom())
          .orElseThrow(() -> new IllegalStateException("Saved exchange rate not found"));
    });
  }

  private boolean regionExists(Connection conn, long regionId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        "SELECT 1 FROM core.region WHERE id = ?"
    )) {
      ps.setLong(1, regionId);
      try (ResultSet rs = ps.executeQuery()) {
        return rs.next();
      }
    }
  }

  private void ensureCurrencyExists(Connection conn, String currencyCode) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        "SELECT 1 FROM core.currency WHERE code = ?"
    )) {
      ps.setString(1, currencyCode);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) {
          throw ServiceException.notFound("Currency not found: " + currencyCode);
        }
      }
    }
  }

  private Optional<OrgDtos.RegionView> findRegionByIdTransactional(Connection conn, long regionId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT id, code, parent_region_id, currency_code, name, tax_code, timezone_name
        FROM core.region
        WHERE id = ?
        """
    )) {
      ps.setLong(1, regionId);
      try (ResultSet rs = ps.executeQuery()) {
        if (rs.next()) {
          return Optional.of(mapRegion(rs));
        }
        return Optional.empty();
      }
    }
  }

  private Optional<OrgDtos.OutletView> findOutletByIdTransactional(Connection conn, long outletId, boolean includeArchived)
      throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        includeArchived
            ? """
              SELECT
                id,
                region_id,
                code,
                name,
                CASE WHEN deleted_at IS NOT NULL THEN 'archived' ELSE status::text END AS lifecycle_status,
                address,
                phone,
                email,
                opened_at,
                closed_at
              FROM core.outlet
              WHERE id = ?
              """
            : """
              SELECT
                id,
                region_id,
                code,
                name,
                CASE WHEN deleted_at IS NOT NULL THEN 'archived' ELSE status::text END AS lifecycle_status,
                address,
                phone,
                email,
                opened_at,
                closed_at
              FROM core.outlet
              WHERE id = ? AND deleted_at IS NULL
              """
    )) {
      ps.setLong(1, outletId);
      try (ResultSet rs = ps.executeQuery()) {
        if (rs.next()) {
          return Optional.of(mapOutlet(rs));
        }
        return Optional.empty();
      }
    }
  }

  private OrgDtos.RegionView mapRegion(ResultSet rs) {
    try {
      Long parentRegionId = (Long) rs.getObject("parent_region_id");
      return new OrgDtos.RegionView(
          rs.getLong("id"),
          rs.getString("code"),
          parentRegionId,
          rs.getString("currency_code"),
          rs.getString("name"),
          rs.getString("tax_code"),
          rs.getString("timezone_name")
      );
    } catch (Exception e) {
      throw new IllegalStateException("Unable to map region", e);
    }
  }

  private OrgDtos.OutletView mapOutlet(ResultSet rs) {
    try {
      return new OrgDtos.OutletView(
          rs.getLong("id"),
          rs.getLong("region_id"),
          rs.getString("code"),
          rs.getString("name"),
          rs.getString("lifecycle_status"),
          rs.getString("address"),
          rs.getString("phone"),
          rs.getString("email"),
          rs.getObject("opened_at", LocalDate.class),
          rs.getObject("closed_at", LocalDate.class)
      );
    } catch (Exception e) {
      throw new IllegalStateException("Unable to map outlet", e);
    }
  }

  private OrgDtos.ExchangeRateView mapExchangeRate(ResultSet rs) {
    try {
      return new OrgDtos.ExchangeRateView(
          rs.getString("from_currency_code"),
          rs.getString("to_currency_code"),
          rs.getBigDecimal("rate"),
          rs.getObject("effective_from", LocalDate.class),
          rs.getObject("effective_to", LocalDate.class),
          rs.getTimestamp("updated_at").toInstant()
      );
    } catch (Exception e) {
      throw new IllegalStateException("Unable to map exchange rate", e);
    }
  }

  private static String normalizeStatus(String status) {
    if (status == null || status.isBlank()) {
      return "draft";
    }
    String normalized = status.trim().toLowerCase();
    if (!List.of("draft", "active", "inactive", "closed").contains(normalized)) {
      throw ServiceException.badRequest("Unsupported outlet status: " + status);
    }
    return normalized;
  }

  private static String trimToNull(String value) {
    if (value == null) {
      return null;
    }
    String trimmed = value.trim();
    return trimmed.isEmpty() ? null : trimmed;
  }
}
