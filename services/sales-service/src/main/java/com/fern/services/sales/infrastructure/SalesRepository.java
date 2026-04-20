package com.fern.services.sales.infrastructure;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.repository.BaseRepository;
import com.dorabets.common.spring.web.PagedResult;
import com.dorabets.common.spring.web.QueryConventions;
import com.fern.services.sales.api.CrmDtos;
import com.fern.services.sales.api.PublicPosDtos;
import com.fern.services.sales.api.SalesDtos;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import javax.sql.DataSource;
import org.springframework.stereotype.Repository;

@Repository
public class SalesRepository extends BaseRepository {

  private static final Set<String> CRM_CUSTOMER_SORT_KEYS =
      Set.of("lastOrderAt", "totalSpend", "orderCount", "displayName", "customerRef");
  private static final Set<String> SALE_LIST_SORT_KEYS =
      Set.of("createdAt", "totalAmount", "status", "paymentStatus", "id");
  private static final Set<String> POS_SESSION_SORT_KEYS =
      Set.of("openedAt", "businessDate", "status", "managerId", "id");
  private static final Set<String> PROMOTION_SORT_KEYS =
      Set.of("effectiveFrom", "name", "status", "createdAt", "id");

  private final SnowflakeIdGenerator snowflakeIdGenerator;
  private final Clock clock;

  public SalesRepository(
      DataSource dataSource,
      SnowflakeIdGenerator snowflakeIdGenerator,
      Clock clock
  ) {
    super(dataSource);
    this.snowflakeIdGenerator = snowflakeIdGenerator;
    this.clock = clock;
  }

  public SalesDtos.PosSessionView openPosSession(SalesDtos.OpenPosSessionRequest request) {
    return executeInTransaction(conn -> {
      long sessionId = snowflakeIdGenerator.generateId();
      Instant now = clock.instant();
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.pos_session (
            id, session_code, outlet_id, currency_code, manager_id, opened_at, business_date, status, note, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?::pos_session_status_enum, ?, ?, ?)
          """
      )) {
        ps.setLong(1, sessionId);
        ps.setString(2, request.sessionCode().trim());
        ps.setLong(3, request.outletId());
        ps.setString(4, request.currencyCode().trim());
        ps.setLong(5, request.managerId());
        ps.setTimestamp(6, Timestamp.from(now));
        ps.setObject(7, request.businessDate());
        ps.setString(8, "open");
        ps.setString(9, trimToNull(request.note()));
        ps.setTimestamp(10, Timestamp.from(now));
        ps.setTimestamp(11, Timestamp.from(now));
        ps.executeUpdate();
      } catch (java.sql.SQLException e) {
        if ("23505".equals(e.getSQLState())) {
          throw ServiceException.conflict("Session code already exists");
        }
        throw e;
      }
      return findPosSession(conn, sessionId)
          .orElseThrow(() -> new IllegalStateException("Created session not found"));
    });
  }

  public SalesDtos.PosSessionView closePosSession(long sessionId, String note) {
    return executeInTransaction(conn -> {
      LockedPosSessionRecord locked = lockPosSession(conn, sessionId)
          .orElseThrow(() -> ServiceException.notFound("POS session not found: " + sessionId));
      if (!"open".equalsIgnoreCase(locked.status())) {
        throw ServiceException.conflict("Only open sessions can be closed");
      }
      try (PreparedStatement chk = conn.prepareStatement(
          """
          SELECT COUNT(*) FROM core.sale_record
          WHERE pos_session_id = ?
            AND public_token IS NULL
            AND status <> 'cancelled'::sale_order_status_enum
            AND payment_status IN ('unpaid'::payment_status_enum, 'partially_paid'::payment_status_enum)
          """
      )) {
        chk.setLong(1, sessionId);
        try (ResultSet rs = chk.executeQuery()) {
          if (rs.next()) {
            int count = rs.getInt(1);
            if (count > 0) {
              throw ServiceException.conflict("SESSION_HAS_UNPAID_ORDERS:" + count);
            }
          }
        }
      }
      try (PreparedStatement ps = conn.prepareStatement(
          """
          UPDATE core.pos_session
          SET status = ?::pos_session_status_enum,
              closed_at = ?,
              note = COALESCE(?, note),
              updated_at = ?
          WHERE id = ?
          """
      )) {
        Timestamp now = Timestamp.from(clock.instant());
        ps.setString(1, "closed");
        ps.setTimestamp(2, now);
        ps.setString(3, trimToNull(note));
        ps.setTimestamp(4, now);
        ps.setLong(5, sessionId);
        if (ps.executeUpdate() == 0) {
          throw ServiceException.notFound("POS session not found: " + sessionId);
        }
      }
      return findPosSession(conn, sessionId)
          .orElseThrow(() -> new IllegalStateException("Closed session not found"));
    });
  }

  public SalesDtos.PosSessionReconciliationView reconcilePosSession(
      long sessionId,
      SalesDtos.ReconcilePosSessionRequest request,
      Long actorUserId
  ) {
    return executeInTransaction(conn -> {
      LockedPosSessionRecord lockedSession = lockPosSession(conn, sessionId)
          .orElseThrow(() -> ServiceException.notFound("POS session not found: " + sessionId));
      String sessionStatus = lockedSession.status().toLowerCase(Locale.ROOT);
      if ("open".equals(sessionStatus)) {
        throw ServiceException.conflict("Only closed sessions can be reconciled");
      }
      if ("cancelled".equals(sessionStatus)) {
        throw ServiceException.conflict("Cancelled sessions cannot be reconciled");
      }
      if (!"closed".equals(sessionStatus) && !"reconciled".equals(sessionStatus)) {
        throw ServiceException.conflict("Session status does not allow reconciliation: " + lockedSession.status());
      }

      Instant now = clock.instant();
      Map<String, BigDecimal> expectedByMethod = loadExpectedPaymentTotalsByMethod(conn, sessionId);
      Map<String, BigDecimal> actualByMethod = resolveActualPaymentTotals(
          request == null ? List.of() : request.lines(),
          expectedByMethod
      );
      List<SalesDtos.PosSessionReconciliationLineView> lines = buildReconciliationLines(expectedByMethod, actualByMethod);
      BigDecimal expectedTotal = lines.stream()
          .map(SalesDtos.PosSessionReconciliationLineView::expectedAmount)
          .reduce(BigDecimal.ZERO, BigDecimal::add)
          .setScale(2, RoundingMode.HALF_UP);
      BigDecimal actualTotal = lines.stream()
          .map(SalesDtos.PosSessionReconciliationLineView::actualAmount)
          .reduce(BigDecimal.ZERO, BigDecimal::add)
          .setScale(2, RoundingMode.HALF_UP);
      BigDecimal discrepancyTotal = actualTotal.subtract(expectedTotal).setScale(2, RoundingMode.HALF_UP);
      String reconciliationNote = mergeReconciliationNote(lockedSession.note(), request == null ? null : request.note());

      upsertPosSessionReconciliation(
          conn,
          sessionId,
          actorUserId,
          now,
          expectedTotal,
          actualTotal,
          discrepancyTotal,
          reconciliationNote,
          lines
      );

      try (PreparedStatement ps = conn.prepareStatement(
          """
          UPDATE core.pos_session
          SET status = 'reconciled'::pos_session_status_enum,
              closed_at = COALESCE(closed_at, ?),
              note = COALESCE(?, note),
              updated_at = ?
          WHERE id = ?
          """
      )) {
        Timestamp nowTs = Timestamp.from(now);
        ps.setTimestamp(1, nowTs);
        ps.setString(2, reconciliationNote);
        ps.setTimestamp(3, nowTs);
        ps.setLong(4, sessionId);
        ps.executeUpdate();
      }

      return loadPosSessionReconciliation(conn, sessionId)
          .orElseThrow(() -> new IllegalStateException("Reconciled session payload not found"));
    });
  }

  public SalesDtos.SaleView submitSale(SalesDtos.SubmitSaleRequest request) {
    return executeInTransaction(
        conn ->
            submitSale(
                conn,
                request,
                clock.instant().atZone(java.time.ZoneOffset.UTC).toLocalDate()));
  }

  public Optional<PublicOrderingTableRecord> findPublicOrderingTable(String tableToken) {
    return queryOne(
        """
        SELECT
          t.id,
          t.outlet_id,
          t.table_code,
          t.display_name,
          t.public_token,
          t.status,
          o.code AS outlet_code,
          o.name AS outlet_name,
          o.status AS outlet_status,
          r.currency_code,
          r.timezone_name
        FROM core.ordering_table t
        JOIN core.outlet o ON o.id = t.outlet_id
        JOIN core.region r ON r.id = o.region_id
        WHERE t.public_token = ?
          AND t.deleted_at IS NULL
        """,
        this::mapPublicOrderingTable,
        tableToken
    );
  }

  public List<SalesDtos.OrderingTableLinkView> listOrderingTables(Set<Long> outletIds, String status) {
    if (outletIds != null && outletIds.isEmpty()) {
      return List.of();
    }
    StringBuilder sql = new StringBuilder(
        """
        SELECT
          t.public_token,
          t.table_code,
          t.display_name,
          t.status,
          t.outlet_id,
          o.code AS outlet_code,
          o.name AS outlet_name
        FROM core.ordering_table t
        JOIN core.outlet o ON o.id = t.outlet_id
        WHERE t.deleted_at IS NULL
        """
    );
    List<Object> params = new ArrayList<>();
    if (outletIds != null && !outletIds.isEmpty()) {
      sql.append(" AND t.outlet_id IN (");
      boolean first = true;
      for (Long outletId : outletIds) {
        if (!first) {
          sql.append(", ");
        }
        sql.append("?");
        params.add(outletId);
        first = false;
      }
      sql.append(")");
    }
    if (status != null && !status.isBlank()) {
      sql.append(" AND t.status = ?::ordering_table_status_enum");
      params.add(status.trim());
    }
    sql.append(" ORDER BY o.code ASC, t.table_code ASC");
    return queryList(sql.toString(), this::mapOrderingTableLink, params.toArray());
  }

  public Optional<SalesDtos.OrderingTableDetailView> findOrderingTableByToken(String tableToken) {
    return queryOne(
        """
        SELECT
          t.id,
          t.public_token,
          t.table_code,
          t.display_name,
          t.status,
          t.outlet_id,
          o.code AS outlet_code,
          o.name AS outlet_name,
          t.created_at,
          t.updated_at
        FROM core.ordering_table t
        JOIN core.outlet o ON o.id = t.outlet_id
        WHERE t.public_token = ?
          AND t.deleted_at IS NULL
        """,
        this::mapOrderingTableDetail,
        tableToken
    );
  }

  public SalesDtos.OrderingTableDetailView createOrderingTable(SalesDtos.CreateOrderingTableRequest request) {
    return executeInTransaction(conn -> {
      long tableId = snowflakeIdGenerator.generateId();
      Instant now = clock.instant();
      String status = normalizeOrderingTableStatus(request.status(), "active");

      boolean inserted = false;
      int attempts = 0;
      while (!inserted && attempts < 5) {
        attempts++;
        String token = UUID.randomUUID().toString().replace("-", "");
        try (PreparedStatement ps = conn.prepareStatement(
            """
            INSERT INTO core.ordering_table (
              id, outlet_id, table_code, display_name, public_token, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?::ordering_table_status_enum, ?, ?)
            """
        )) {
          ps.setLong(1, tableId);
          ps.setLong(2, request.outletId());
          ps.setString(3, request.tableCode().trim());
          ps.setString(4, request.tableName().trim());
          ps.setString(5, token);
          ps.setString(6, status);
          ps.setTimestamp(7, Timestamp.from(now));
          ps.setTimestamp(8, Timestamp.from(now));
          ps.executeUpdate();
          inserted = true;
        } catch (java.sql.SQLException e) {
          if ("23505".equals(e.getSQLState())) {
            String constraint = e.getMessage() == null ? "" : e.getMessage();
            if (constraint.contains("uq_ordering_table_public_token")) {
              continue;
            }
            if (constraint.contains("uq_ordering_table_outlet_code")) {
              throw ServiceException.conflict("Table code already exists for outlet " + request.outletId());
            }
          }
          throw e;
        }
      }

      if (!inserted) {
        throw new IllegalStateException("Unable to allocate unique ordering-table token");
      }
      return findOrderingTableById(conn, tableId)
          .orElseThrow(() -> new IllegalStateException("Created ordering table not found: " + tableId));
    });
  }

  public SalesDtos.OrderingTableDetailView updateOrderingTable(
      String tableToken,
      SalesDtos.UpdateOrderingTableRequest request
  ) {
    return executeInTransaction(conn -> {
      OrderingTableRecord existing = lockOrderingTableByToken(conn, tableToken)
          .orElseThrow(() -> ServiceException.notFound("Ordering table not found: " + tableToken));
      String nextTableName = trimToNull(request == null ? null : request.tableName());
      String nextStatus = normalizeOrderingTableStatus(
          request == null ? null : request.status(),
          existing.status()
      );

      try (PreparedStatement ps = conn.prepareStatement(
          """
          UPDATE core.ordering_table
          SET display_name = COALESCE(?, display_name),
              status = ?::ordering_table_status_enum,
              updated_at = ?
          WHERE id = ?
          """
      )) {
        ps.setString(1, nextTableName);
        ps.setString(2, nextStatus);
        ps.setTimestamp(3, Timestamp.from(clock.instant()));
        ps.setLong(4, existing.id());
        ps.executeUpdate();
      }

      return findOrderingTableById(conn, existing.id())
          .orElseThrow(() -> new IllegalStateException("Updated ordering table not found: " + existing.id()));
    });
  }

  public PagedResult<CrmDtos.CustomerView> listCustomerReferences(
      Set<Long> outletIds,
      String query,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    if (outletIds != null && outletIds.isEmpty()) {
      return PagedResult.of(List.of(), Math.max(1, Math.min(limit, 500)), Math.max(offset, 0), 0);
    }
    return executeInTransaction(conn -> {
      StringBuilder sql = new StringBuilder(
          """
          SELECT
            sr.public_token AS customer_ref,
            'public_order_token' AS reference_type,
            COALESCE(MAX(t.display_name), 'Public order guest') AS display_name,
            sr.outlet_id,
            o.code AS outlet_code,
            o.name AS outlet_name,
            COUNT(*) AS order_count,
            COALESCE(SUM(sr.total_amount), 0) AS total_spend,
            MAX(sr.created_at) AS last_order_at,
            COUNT(*) OVER() AS total_count
          FROM core.sale_record sr
          JOIN core.outlet o ON o.id = sr.outlet_id
          LEFT JOIN core.ordering_table t ON t.id = sr.ordering_table_id
          WHERE sr.public_token IS NOT NULL
          """
      );
      List<Object> params = new ArrayList<>();
      if (outletIds != null && !outletIds.isEmpty()) {
        appendOutletScope(sql, params, "sr.outlet_id", outletIds);
      }
      if (query != null && !query.isBlank()) {
        sql.append(" AND (sr.public_token ILIKE ? OR t.display_name ILIKE ? OR t.table_code ILIKE ?)");
        String pattern = '%' + query.trim() + '%';
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
      }
      sql.append(" GROUP BY sr.public_token, sr.outlet_id, o.code, o.name ORDER BY ")
          .append(resolveCustomerSortClause(sortBy, sortDir))
          .append(" LIMIT ? OFFSET ?");
      params.add(Math.max(1, Math.min(limit, 500)));
      params.add(Math.max(offset, 0));

      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bindParams(ps, params);
        try (ResultSet rs = ps.executeQuery()) {
          List<CrmDtos.CustomerView> rows = new ArrayList<>();
          long totalCount = 0;
          while (rs.next()) {
            totalCount = rs.getLong("total_count");
            rows.add(mapCustomerReference(rs));
          }
          return PagedResult.of(rows, Math.max(1, Math.min(limit, 500)), Math.max(offset, 0), totalCount);
        }
      }
    });
  }

  private String resolveCustomerSortClause(String sortBy, String sortDir) {
    String key = QueryConventions.normalizeSortBy(sortBy, CRM_CUSTOMER_SORT_KEYS, "lastOrderAt");
    String direction = QueryConventions.normalizeSortDir(sortDir);
    return switch (key) {
      case "totalSpend" -> "total_spend " + direction + ", last_order_at DESC, customer_ref DESC";
      case "orderCount" -> "order_count " + direction + ", last_order_at DESC, customer_ref DESC";
      case "displayName" -> "display_name " + direction + ", last_order_at DESC, customer_ref DESC";
      case "customerRef" -> "customer_ref " + direction;
      case "lastOrderAt" -> "last_order_at " + direction + ", customer_ref " + direction;
      default -> throw new IllegalArgumentException("Unsupported customer sort key");
    };
  }

  public List<PublicPosDtos.PublicMenuItemView> listPublicMenu(long outletId, LocalDate businessDate) {
    return executeInTransaction(conn -> listPublicMenu(conn, outletId, businessDate, null));
  }

  public CreatedPublicOrder submitPublicOrder(
      PublicOrderingTableRecord table,
      PublicPosDtos.CreatePublicOrderRequest request,
      LocalDate businessDate
  ) {
    return executeInTransaction(conn -> {
      validatePublicOrderItems(conn, table.outletId(), businessDate, request.items());
      List<SalesDtos.SaleLineRequest> lines = request.items().stream()
          .map(item -> new SalesDtos.SaleLineRequest(
              parsePublicProductId(item.productId()),
              item.quantity(),
              BigDecimal.ZERO,
              BigDecimal.ZERO,
              trimToNull(item.note()),
              Set.of()
          ))
          .toList();
      String orderToken = "ord_" + UUID.randomUUID().toString().replace("-", "");
      SalesDtos.SaleView sale = submitSale(conn, new SalesDtos.SubmitSaleRequest(
          table.outletId(),
          null,
          table.currencyCode(),
          "online",
          buildPublicOrderNote(table.tableCode(), table.displayName(), request.note()),
          lines,
          null
      ), businessDate, new PublicOrderMetadata(table.id(), orderToken));
      return new CreatedPublicOrder(orderToken, sale);
    });
  }

  public Optional<CreatedPublicOrder> findPublicOrder(String tableToken, String orderToken) {
    return executeInTransaction(conn -> {
      String sql = """
          SELECT sr.id
          FROM core.sale_record sr
          JOIN core.ordering_table t ON t.id = sr.ordering_table_id
          WHERE t.public_token = ?
            AND sr.public_token = ?
          """;
      try (PreparedStatement ps = conn.prepareStatement(sql)) {
        ps.setString(1, tableToken);
        ps.setString(2, orderToken);
        try (ResultSet rs = ps.executeQuery()) {
          if (!rs.next()) {
            return Optional.empty();
          }
          long saleId = rs.getLong("id");
          SalesDtos.SaleView sale = findSale(conn, saleId)
              .orElseThrow(() -> new IllegalStateException("Customer order not found after lookup"));
          return Optional.of(new CreatedPublicOrder(orderToken, sale));
        }
      }
    });
  }

  private SalesDtos.SaleView submitSale(
      Connection conn,
      SalesDtos.SubmitSaleRequest request,
      LocalDate pricingDate
  ) throws Exception {
    return submitSale(conn, request, pricingDate, null);
  }

  private SalesDtos.SaleView submitSale(
      Connection conn,
      SalesDtos.SubmitSaleRequest request,
      LocalDate pricingDate,
      PublicOrderMetadata publicOrderMetadata
  ) throws Exception {
    if (request.payment() != null) {
      throw ServiceException.badRequest("Payment is captured with mark-payment-done after order approval");
    }
    SalesDtos.PosSessionView session = null;
    if (request.posSessionId() != null) {
      session = findPosSession(conn, request.posSessionId())
          .orElseThrow(
              () ->
                  ServiceException.notFound(
                      "POS session not found: " + request.posSessionId()));
      if (!"open".equalsIgnoreCase(session.status())) {
        throw ServiceException.conflict("POS session is not open");
      }
    }

    long saleId = snowflakeIdGenerator.generateId();
    Instant now = clock.instant();
    Map<Long, AggregatedSaleLine> aggregatedLines =
        aggregateLines(conn, request, pricingDate);
    validateStockAvailability(
        conn,
        request.outletId(),
        aggregatedLines,
        false,
        "One or more items do not have enough stock to create this order");

    BigDecimal subtotal = BigDecimal.ZERO;
    BigDecimal totalDiscount = BigDecimal.ZERO;
    BigDecimal totalTax = BigDecimal.ZERO;
    for (AggregatedSaleLine line : aggregatedLines.values()) {
      subtotal = subtotal.add(line.unitPrice().multiply(line.quantity()));
      totalDiscount = totalDiscount.add(line.discountAmount());
      totalTax = totalTax.add(line.taxAmount());
    }
    subtotal = subtotal.setScale(2, RoundingMode.HALF_UP);
    totalDiscount = totalDiscount.setScale(2, RoundingMode.HALF_UP);
    totalTax = totalTax.setScale(2, RoundingMode.HALF_UP);
    BigDecimal totalAmount =
        subtotal.subtract(totalDiscount).add(totalTax).setScale(2, RoundingMode.HALF_UP);

    try (PreparedStatement ps =
        conn.prepareStatement(
            """
            INSERT INTO core.sale_record (
              id, outlet_id, pos_session_id, ordering_table_id, public_token, currency_code, order_type, status, payment_status,
              subtotal, discount, tax_amount, total_amount, note, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?::order_type_enum, ?::sale_order_status_enum, ?::payment_status_enum,
                      ?, ?, ?, ?, ?, ?, ?)
            """)) {
      ps.setLong(1, saleId);
        ps.setLong(2, request.outletId());
      if (request.posSessionId() == null) {
        ps.setNull(3, java.sql.Types.BIGINT);
      } else {
        ps.setLong(3, request.posSessionId());
      }
      if (publicOrderMetadata == null) {
        ps.setNull(4, java.sql.Types.BIGINT);
        ps.setNull(5, java.sql.Types.VARCHAR);
      } else {
        ps.setLong(4, publicOrderMetadata.orderingTableId());
        ps.setString(5, publicOrderMetadata.orderToken());
      }
      ps.setString(6, request.currencyCode().trim());
      ps.setString(7, normalizeOrderType(request.orderType()));
      ps.setString(8, "order_created");
      ps.setString(9, "unpaid");
      ps.setBigDecimal(10, subtotal);
      ps.setBigDecimal(11, totalDiscount);
      ps.setBigDecimal(12, totalTax);
      ps.setBigDecimal(13, totalAmount);
      ps.setString(14, trimToNull(request.note()));
      ps.setTimestamp(15, Timestamp.from(now));
      ps.setTimestamp(16, Timestamp.from(now));
      ps.executeUpdate();
    }

    insertSaleItems(conn, saleId, aggregatedLines.values(), now);
    insertSalePromotions(conn, saleId, aggregatedLines.values(), now);
    return findSale(conn, saleId)
        .orElseThrow(() -> new IllegalStateException("Created sale not found"));
  }

  public Optional<SalesDtos.SaleView> findSale(long saleId) {
    return queryOne(
        """
        SELECT
          sr.id,
          sr.outlet_id,
          sr.pos_session_id,
          sr.public_token,
          t.table_code,
          t.display_name,
          sr.currency_code,
          sr.order_type,
          sr.status,
          sr.payment_status,
          sr.subtotal,
          sr.discount,
          sr.tax_amount,
          sr.total_amount,
          sr.note,
          sr.created_at
        FROM core.sale_record sr
        LEFT JOIN core.ordering_table t ON t.id = sr.ordering_table_id
        WHERE sr.id = ?
        """,
        rs -> mapSaleHeader(rs, loadSaleItems(saleId), loadPayment(saleId).orElse(null)),
        saleId
    );
  }

  public Optional<SalesDtos.PosSessionView> findPosSession(long sessionId) {
    return executeInTransaction(conn -> findPosSession(conn, sessionId));
  }

  public SalesDtos.SaleView approveSale(long saleId, Long actorUserId) {
    return executeInTransaction(conn -> {
      LockedSaleRecord lockedSale = lockSale(conn, saleId)
          .orElseThrow(() -> ServiceException.notFound("Sale not found: " + saleId));
      if (!isApprovableStatus(lockedSale.status())) {
        throw ServiceException.conflict("Only newly created orders can be approved");
      }
      Map<Long, AggregatedSaleLine> aggregatedLines = loadSaleLinesForInventory(conn, saleId);
      validateStockAvailability(
          conn,
          lockedSale.outletId(),
          aggregatedLines,
          true,
          "One or more items no longer have enough stock to approve this order");
      try {
        applyInventoryUsageForSale(
            conn,
            saleId,
            lockedSale.outletId(),
            lockedSale.businessDate(),
            actorUserId,
            aggregatedLines
        );
      } catch (java.sql.SQLException e) {
        if (isNegativeStockViolation(e)) {
          throw ServiceException.conflict("Stock changed before the order could be approved");
        }
        throw e;
      }
      try (PreparedStatement ps = conn.prepareStatement(
          """
          UPDATE core.sale_record
          SET status = 'order_approved'::sale_order_status_enum,
              payment_status = 'unpaid'::payment_status_enum,
              updated_at = NOW()
          WHERE id = ?
          """
      )) {
        ps.setLong(1, saleId);
        ps.executeUpdate();
      }
      return findSale(conn, saleId)
          .orElseThrow(() -> new IllegalStateException("Approved sale not found"));
    });
  }

  public SalesDtos.SaleView markPaymentDone(long saleId, SalesDtos.MarkPaymentDoneRequest request) {
    return executeInTransaction(conn -> {
      LockedSaleRecord lockedSale = lockSale(conn, saleId)
          .orElseThrow(() -> ServiceException.notFound("Sale not found: " + saleId));
      if (!"order_approved".equalsIgnoreCase(lockedSale.status())) {
        throw ServiceException.conflict("Only approved orders can be marked as payment done");
      }
      BigDecimal amount = money(request.amount()).setScale(2, RoundingMode.HALF_UP);
      if (amount.compareTo(lockedSale.totalAmount().setScale(2, RoundingMode.HALF_UP)) != 0) {
        throw ServiceException.conflict("Payment amount must match the approved order total");
      }
      Instant paymentTime = request.paymentTime() == null ? clock.instant() : request.paymentTime();
      upsertPayment(conn, saleId, lockedSale.posSessionId(), request, amount, paymentTime);
      try (PreparedStatement ps = conn.prepareStatement(
          """
          UPDATE core.sale_record
          SET status = 'payment_done'::sale_order_status_enum,
              payment_status = 'paid'::payment_status_enum,
              updated_at = NOW()
          WHERE id = ?
          """
      )) {
        ps.setLong(1, saleId);
        ps.executeUpdate();
      }
      return findSale(conn, saleId)
          .orElseThrow(() -> new IllegalStateException("Paid sale not found"));
    });
  }

  public SalesDtos.SaleView cancelSale(long saleId, String reason, Long actorUserId) {
    return executeInTransaction(conn -> {
      LockedSaleRecord lockedSale = lockSale(conn, saleId)
          .orElseThrow(() -> ServiceException.notFound("Sale not found: " + saleId));
      String status = lockedSale.status().toLowerCase(Locale.ROOT);
      if ("cancelled".equals(status)) {
        return findSale(conn, saleId)
            .orElseThrow(() -> new IllegalStateException("Cancelled sale not found"));
      }
      if (!isCancellableStatus(status)) {
        String paymentStatus = readPaymentStatus(conn, saleId);
        if ("order_approved".equalsIgnoreCase(status)
            && paymentStatus != null
            && !"paid".equalsIgnoreCase(paymentStatus)) {
          // approved but not yet paid — allow cancel
        } else {
          throw ServiceException.conflict("Only unpaid orders can be cancelled");
        }
      }

      String cancellationNote = buildCancellationNote(lockedSale.note(), reason, actorUserId);
      try (PreparedStatement ps = conn.prepareStatement(
          """
          UPDATE core.sale_record
          SET status = 'cancelled'::sale_order_status_enum,
              payment_status = 'unpaid'::payment_status_enum,
              note = COALESCE(?, note),
              updated_at = NOW()
          WHERE id = ?
          """
      )) {
        ps.setString(1, cancellationNote);
        ps.setLong(2, saleId);
        ps.executeUpdate();
      }
      return findSale(conn, saleId)
          .orElseThrow(() -> new IllegalStateException("Cancelled sale not found"));
    });
  }

  public PagedResult<SalesDtos.SaleListItemView> listSales(
      Set<Long> outletIds,
      LocalDate startDate,
      LocalDate endDate,
      String status,
      String paymentStatus,
      Boolean publicOrderOnly,
      Long posSessionId,
      String q,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    if (outletIds != null && outletIds.isEmpty()) {
      return PagedResult.of(List.of(), limit, offset, 0);
    }
    return executeInTransaction(conn -> {
      StringBuilder sql = new StringBuilder(
          """
          SELECT
            sr.id,
            sr.outlet_id,
            sr.pos_session_id,
            sr.public_token,
            t.table_code,
            t.display_name,
            sr.currency_code,
            sr.order_type,
            sr.status,
            sr.payment_status,
            sr.subtotal,
            sr.discount,
            sr.tax_amount,
            sr.total_amount,
            sr.note,
            sr.created_at,
            COUNT(*) OVER() AS total_count
          FROM core.sale_record sr
          LEFT JOIN core.ordering_table t ON t.id = sr.ordering_table_id
          WHERE 1 = 1
          """
      );
      List<Object> params = new ArrayList<>();
      appendOutletScope(sql, params, "sr.outlet_id", outletIds);
      if (startDate != null) {
        sql.append(" AND sr.created_at >= ?");
        params.add(Timestamp.from(startDate.atStartOfDay(java.time.ZoneOffset.UTC).toInstant()));
      }
      if (endDate != null) {
        sql.append(" AND sr.created_at < ?");
        params.add(Timestamp.from(endDate.plusDays(1).atStartOfDay(java.time.ZoneOffset.UTC).toInstant()));
      }
      if (status != null && !status.isBlank()) {
        sql.append(" AND sr.status = ?::sale_order_status_enum");
        params.add(status.trim());
      }
      if (paymentStatus != null && !paymentStatus.isBlank()) {
        sql.append(" AND sr.payment_status = ?::payment_status_enum");
        params.add(paymentStatus.trim());
      }
      if (publicOrderOnly != null) {
        sql.append(publicOrderOnly ? " AND sr.public_token IS NOT NULL" : " AND sr.public_token IS NULL");
      }
      if (posSessionId != null) {
        sql.append(" AND sr.pos_session_id = ?");
        params.add(posSessionId);
      }
      if (q != null && !q.isBlank()) {
        String pattern = "%" + q + "%";
        sql.append(
            """
             AND (
               sr.id::text ILIKE ?
               OR sr.currency_code ILIKE ?
               OR sr.order_type::text ILIKE ?
               OR sr.status::text ILIKE ?
               OR sr.payment_status::text ILIKE ?
               OR COALESCE(sr.public_token, '') ILIKE ?
               OR COALESCE(t.table_code, '') ILIKE ?
               OR COALESCE(t.display_name, '') ILIKE ?
               OR COALESCE(sr.note, '') ILIKE ?
             )
            """
        );
        for (int i = 0; i < 9; i++) {
          params.add(pattern);
        }
      }
      sql.append(" ORDER BY ").append(resolveSaleListSortClause(sortBy, sortDir)).append(" LIMIT ? OFFSET ?");
      params.add(limit);
      params.add(offset);
      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bindParams(ps, params);
        try (ResultSet rs = ps.executeQuery()) {
          List<SalesDtos.SaleListItemView> rows = new ArrayList<>();
          long totalCount = 0;
          while (rs.next()) {
            totalCount = rs.getLong("total_count");
            rows.add(mapSaleListItem(rs));
          }
          return PagedResult.of(rows, limit, offset, totalCount);
        }
      }
    });
  }

  public PagedResult<SalesDtos.PosSessionListItemView> listPosSessions(
      Set<Long> outletIds,
      LocalDate businessDate,
      LocalDate startDate,
      LocalDate endDate,
      String status,
      Long managerId,
      String q,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    if (outletIds != null && outletIds.isEmpty()) {
      return PagedResult.of(List.of(), limit, offset, 0);
    }
    return executeInTransaction(conn -> {
      StringBuilder sql = new StringBuilder(
          """
          SELECT ps.id, ps.session_code, ps.outlet_id, ps.currency_code, ps.manager_id,
                 ps.opened_at, ps.closed_at, ps.business_date, ps.status, ps.note,
                 COALESCE(agg.order_count, 0) AS order_count,
                 COALESCE(agg.total_revenue, 0) AS total_revenue,
                 COUNT(*) OVER() AS total_count
          FROM core.pos_session ps
          LEFT JOIN LATERAL (
            SELECT COUNT(*) AS order_count,
                   COALESCE(SUM(CASE WHEN sr.status IN ('payment_done', 'completed') THEN sr.total_amount ELSE 0 END), 0) AS total_revenue
            FROM core.sale_record sr
            WHERE sr.pos_session_id = ps.id
          ) agg ON true
          WHERE 1 = 1
          """
      );
      List<Object> params = new ArrayList<>();
      appendOutletScope(sql, params, "ps.outlet_id", outletIds);
      if (businessDate != null) {
        sql.append(" AND ps.business_date = ?");
        params.add(businessDate);
      }
      if (startDate != null) {
        sql.append(" AND ps.opened_at >= ?");
        params.add(Timestamp.from(startDate.atStartOfDay(java.time.ZoneOffset.UTC).toInstant()));
      }
      if (endDate != null) {
        sql.append(" AND ps.opened_at < ?");
        params.add(Timestamp.from(endDate.plusDays(1).atStartOfDay(java.time.ZoneOffset.UTC).toInstant()));
      }
      if (status != null && !status.isBlank()) {
        sql.append(" AND ps.status = ?::pos_session_status_enum");
        params.add(status.trim());
      }
      if (managerId != null) {
        sql.append(" AND ps.manager_id = ?");
        params.add(managerId);
      }
      if (q != null && !q.isBlank()) {
        String pattern = "%" + q + "%";
        sql.append(
            """
             AND (
               ps.id::text ILIKE ?
               OR ps.session_code ILIKE ?
               OR ps.currency_code ILIKE ?
               OR ps.status::text ILIKE ?
               OR COALESCE(ps.note, '') ILIKE ?
               OR COALESCE(ps.manager_id::text, '') ILIKE ?
             )
            """
        );
        for (int i = 0; i < 6; i++) {
          params.add(pattern);
        }
      }
      sql.append(" ORDER BY ").append(resolvePosSessionSortClause(sortBy, sortDir)).append(" LIMIT ? OFFSET ?");
      params.add(limit);
      params.add(offset);
      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bindParams(ps, params);
        try (ResultSet rs = ps.executeQuery()) {
          List<SalesDtos.PosSessionListItemView> rows = new ArrayList<>();
          long totalCount = 0;
          while (rs.next()) {
            totalCount = rs.getLong("total_count");
            rows.add(mapPosSessionListItem(rs));
          }
          return PagedResult.of(rows, limit, offset, totalCount);
        }
      }
    });
  }

  public SalesDtos.OutletStatsView getOutletStats(long outletId, LocalDate businessDate) {
    return executeInTransaction(conn -> {
      Instant start = businessDate.atStartOfDay(java.time.ZoneOffset.UTC).toInstant();
      Instant end = businessDate.plusDays(1).atStartOfDay(java.time.ZoneOffset.UTC).toInstant();

      long ordersToday = 0;
      long completedSales = 0;
      long cancelledOrders = 0;
      BigDecimal revenueToday = BigDecimal.ZERO;

      try (PreparedStatement ps = conn.prepareStatement(
          """
          SELECT
            COUNT(*) AS orders_today,
            COALESCE(SUM(CASE WHEN status IN ('payment_done'::sale_order_status_enum, 'completed'::sale_order_status_enum) THEN 1 ELSE 0 END), 0) AS completed_sales,
            COALESCE(SUM(CASE WHEN status = 'cancelled'::sale_order_status_enum THEN 1 ELSE 0 END), 0) AS cancelled_orders,
            COALESCE(SUM(CASE WHEN status IN ('payment_done'::sale_order_status_enum, 'completed'::sale_order_status_enum) THEN total_amount ELSE 0 END), 0) AS revenue_today
          FROM core.sale_record
          WHERE outlet_id = ?
            AND created_at >= ?
            AND created_at < ?
          """
      )) {
        ps.setLong(1, outletId);
        ps.setTimestamp(2, Timestamp.from(start));
        ps.setTimestamp(3, Timestamp.from(end));
        try (ResultSet rs = ps.executeQuery()) {
          if (rs.next()) {
            ordersToday = rs.getLong("orders_today");
            completedSales = rs.getLong("completed_sales");
            cancelledOrders = rs.getLong("cancelled_orders");
            revenueToday = money(rs.getBigDecimal("revenue_today"));
          }
        }
      }

      String activeSessionCode = null;
      String activeSessionStatus = null;
      try (PreparedStatement ps = conn.prepareStatement(
          """
          SELECT session_code, status
          FROM core.pos_session
          WHERE outlet_id = ?
            AND business_date = ?
            AND status = 'open'::pos_session_status_enum
          ORDER BY opened_at DESC
          LIMIT 1
          """
      )) {
        ps.setLong(1, outletId);
        ps.setObject(2, businessDate);
        try (ResultSet rs = ps.executeQuery()) {
          if (rs.next()) {
            activeSessionCode = rs.getString("session_code");
            activeSessionStatus = rs.getString("status");
          }
        }
      }

      String topCategory = "N/A";
      try (PreparedStatement ps = conn.prepareStatement(
          """
          SELECT COALESCE(p.category_code, 'uncategorized') AS category_code, COALESCE(SUM(si.qty), 0) AS qty_total
          FROM core.sale_record sr
          JOIN core.sale_item si ON si.sale_id = sr.id
          LEFT JOIN core.product p ON p.id = si.product_id
          WHERE sr.outlet_id = ?
            AND sr.created_at >= ?
            AND sr.created_at < ?
            AND sr.status IN ('payment_done'::sale_order_status_enum, 'completed'::sale_order_status_enum)
          GROUP BY COALESCE(p.category_code, 'uncategorized')
          ORDER BY qty_total DESC, category_code
          LIMIT 1
          """
      )) {
        ps.setLong(1, outletId);
        ps.setTimestamp(2, Timestamp.from(start));
        ps.setTimestamp(3, Timestamp.from(end));
        try (ResultSet rs = ps.executeQuery()) {
          if (rs.next()) {
            topCategory = rs.getString("category_code");
          }
        }
      }

      Map<Integer, BigDecimal> revenueByHour = new LinkedHashMap<>();
      for (int hour = 0; hour < 24; hour++) {
        revenueByHour.put(hour, BigDecimal.ZERO.setScale(2, RoundingMode.HALF_UP));
      }
      try (PreparedStatement ps = conn.prepareStatement(
          """
          SELECT
            EXTRACT(HOUR FROM created_at AT TIME ZONE 'UTC')::int AS hour_of_day,
            COALESCE(SUM(CASE WHEN status IN ('payment_done'::sale_order_status_enum, 'completed'::sale_order_status_enum) THEN total_amount ELSE 0 END), 0) AS revenue
          FROM core.sale_record
          WHERE outlet_id = ?
            AND created_at >= ?
            AND created_at < ?
          GROUP BY hour_of_day
          ORDER BY hour_of_day
          """
      )) {
        ps.setLong(1, outletId);
        ps.setTimestamp(2, Timestamp.from(start));
        ps.setTimestamp(3, Timestamp.from(end));
        try (ResultSet rs = ps.executeQuery()) {
          while (rs.next()) {
            int hourOfDay = rs.getInt("hour_of_day");
            revenueByHour.put(hourOfDay, money(rs.getBigDecimal("revenue")));
          }
        }
      }

      List<SalesDtos.OutletHourlyRevenuePoint> hourlyRevenue = new ArrayList<>();
      int peakHourValue = 0;
      BigDecimal peakRevenue = BigDecimal.valueOf(-1);
      for (Map.Entry<Integer, BigDecimal> entry : revenueByHour.entrySet()) {
        int hourOfDay = entry.getKey();
        BigDecimal value = money(entry.getValue());
        if (value.compareTo(peakRevenue) > 0) {
          peakRevenue = value;
          peakHourValue = hourOfDay;
        }
        hourlyRevenue.add(new SalesDtos.OutletHourlyRevenuePoint(
            String.format("%02d:00", hourOfDay),
            value
        ));
      }

      BigDecimal averageOrderValue = completedSales == 0
          ? BigDecimal.ZERO.setScale(2, RoundingMode.HALF_UP)
          : revenueToday.divide(BigDecimal.valueOf(completedSales), 2, RoundingMode.HALF_UP);

      return new SalesDtos.OutletStatsView(
          outletId,
          businessDate,
          ordersToday,
          completedSales,
          cancelledOrders,
          revenueToday,
          averageOrderValue,
          activeSessionCode,
          activeSessionStatus,
          topCategory,
          String.format("%02d:00", peakHourValue),
          hourlyRevenue
      );
    });
  }

  public PagedResult<SalesDtos.PromotionView> listPromotions(
      Set<Long> outletIds,
      String status,
      Instant effectiveAt,
      String q,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    return executeInTransaction(conn -> {
      String normalizedStatus = normalizePromotionStatusFilter(status);
      StringBuilder sql = new StringBuilder(
          """
          SELECT p.id, p.name, p.promo_type, p.status, p.value_amount, p.value_percent, p.effective_from, p.effective_to,
                 COUNT(*) OVER() AS total_count
          FROM core.promotion p
          WHERE 1 = 1
          """
      );
      List<Object> params = new ArrayList<>();
      appendPromotionScope(sql, params, outletIds);
      if (normalizedStatus != null) {
        sql.append(" AND p.status = ?::promo_status_enum");
        params.add(normalizedStatus);
      }
      if (effectiveAt != null) {
        sql.append(" AND p.effective_from <= ?");
        params.add(Timestamp.from(effectiveAt));
        sql.append(" AND (p.effective_to IS NULL OR p.effective_to >= ?)");
        params.add(Timestamp.from(effectiveAt));
      }
      if (q != null && !q.isBlank()) {
        String pattern = "%" + q + "%";
        sql.append(
            """
             AND (
               p.id::text ILIKE ?
               OR p.name ILIKE ?
               OR p.promo_type::text ILIKE ?
               OR p.status::text ILIKE ?
             )
            """
        );
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
      }
      sql.append(" ORDER BY ").append(resolvePromotionSortClause(sortBy, sortDir)).append(" LIMIT ? OFFSET ?");
      params.add(limit);
      params.add(offset);
      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bindParams(ps, params);
        try (ResultSet rs = ps.executeQuery()) {
          List<SalesDtos.PromotionView> rows = new ArrayList<>();
          long totalCount = 0;
          while (rs.next()) {
            totalCount = rs.getLong("total_count");
            rows.add(mapPromotion(rs, conn));
          }
          return PagedResult.of(rows, limit, offset, totalCount);
        }
      }
    });
  }

  public Optional<SalesDtos.PromotionView> findPromotion(long promotionId) {
    return executeInTransaction(conn -> findPromotion(conn, promotionId));
  }

  private String resolveSaleListSortClause(String sortBy, String sortDir) {
    String key = QueryConventions.normalizeSortBy(sortBy, SALE_LIST_SORT_KEYS, "createdAt");
    String direction = QueryConventions.normalizeSortDir(sortDir);
    return switch (key) {
      case "totalAmount" -> "sr.total_amount " + direction + ", sr.id " + direction;
      case "status" -> "sr.status " + direction + ", sr.created_at DESC, sr.id DESC";
      case "paymentStatus" -> "sr.payment_status " + direction + ", sr.created_at DESC, sr.id DESC";
      case "id" -> "sr.id " + direction;
      case "createdAt" -> "sr.created_at " + direction + ", sr.id " + direction;
      default -> throw new IllegalArgumentException("Unsupported sales sort key");
    };
  }

  private String resolvePosSessionSortClause(String sortBy, String sortDir) {
    String key = QueryConventions.normalizeSortBy(sortBy, POS_SESSION_SORT_KEYS, "openedAt");
    String direction = QueryConventions.normalizeSortDir(sortDir);
    return switch (key) {
      case "businessDate" -> "ps.business_date " + direction + ", ps.opened_at DESC, ps.id DESC";
      case "status" -> "ps.status " + direction + ", ps.opened_at DESC, ps.id DESC";
      case "managerId" -> "ps.manager_id " + direction + " NULLS LAST, ps.opened_at DESC, ps.id DESC";
      case "id" -> "ps.id " + direction;
      case "openedAt" -> "ps.opened_at " + direction + ", ps.id " + direction;
      default -> throw new IllegalArgumentException("Unsupported pos session sort key");
    };
  }

  private String resolvePromotionSortClause(String sortBy, String sortDir) {
    String key = QueryConventions.normalizeSortBy(sortBy, PROMOTION_SORT_KEYS, "effectiveFrom");
    String direction = QueryConventions.normalizeSortDir(sortDir);
    return switch (key) {
      case "name" -> "p.name " + direction + ", p.id " + direction;
      case "status" -> "p.status " + direction + ", p.effective_from DESC, p.id DESC";
      case "createdAt" -> "p.created_at " + direction + ", p.id " + direction;
      case "id" -> "p.id " + direction;
      case "effectiveFrom" -> "p.effective_from " + direction + ", p.id " + direction;
      default -> throw new IllegalArgumentException("Unsupported promotion sort key");
    };
  }

  public SalesDtos.PromotionView createPromotion(SalesDtos.CreatePromotionRequest request) {
    return executeInTransaction(conn -> {
      long promotionId = snowflakeIdGenerator.generateId();
      Instant now = clock.instant();
      String normalizedPromoType = normalizePromotionType(request.promoType());
      String initialStatus = resolvePromotionStatusForCreate(request.effectiveFrom(), now);
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.promotion (
            id, name, promo_type, status, value_amount, value_percent, min_order_amount,
            max_discount_amount, effective_from, effective_to, created_at, updated_at
          ) VALUES (?, ?, ?::promo_type_enum, ?::promo_status_enum, ?, ?, ?, ?, ?, ?, ?, ?)
          """
      )) {
        ps.setLong(1, promotionId);
        ps.setString(2, request.name().trim());
        ps.setString(3, normalizedPromoType);
        ps.setString(4, initialStatus);
        ps.setBigDecimal(5, request.valueAmount());
        ps.setBigDecimal(6, request.valuePercent());
        ps.setBigDecimal(7, request.minOrderAmount());
        ps.setBigDecimal(8, request.maxDiscountAmount());
        ps.setTimestamp(9, Timestamp.from(request.effectiveFrom()));
        ps.setTimestamp(10, request.effectiveTo() == null ? null : Timestamp.from(request.effectiveTo()));
        ps.setTimestamp(11, Timestamp.from(now));
        ps.setTimestamp(12, Timestamp.from(now));
        ps.executeUpdate();
      }
      if (request.outletIds() != null) {
        for (Long outletId : request.outletIds()) {
          try (PreparedStatement ps = conn.prepareStatement(
              """
              INSERT INTO core.promotion_scope (promotion_id, outlet_id, created_at)
              VALUES (?, ?, ?)
              """
          )) {
            ps.setLong(1, promotionId);
            ps.setLong(2, outletId);
            ps.setTimestamp(3, Timestamp.from(now));
            ps.executeUpdate();
          }
        }
      }
      return findPromotion(conn, promotionId)
          .orElseThrow(() -> new IllegalStateException("Created promotion not found"));
    });
  }

  public SalesDtos.PromotionView updatePromotionStatus(long promotionId, String status) {
    return executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          UPDATE core.promotion
          SET status = ?::promo_status_enum,
              updated_at = NOW()
          WHERE id = ?
          """
      )) {
        ps.setString(1, status);
        ps.setLong(2, promotionId);
        if (ps.executeUpdate() == 0) {
          throw ServiceException.notFound("Promotion not found: " + promotionId);
        }
      }
      return findPromotion(conn, promotionId)
          .orElseThrow(() -> new IllegalStateException("Promotion not found after status update"));
    });
  }

  public SalesDtos.PromotionView updatePromotion(long promotionId, SalesDtos.UpdatePromotionRequest request) {
    return executeInTransaction(conn -> {
      Instant now = clock.instant();
      StringBuilder sql = new StringBuilder("UPDATE core.promotion SET updated_at = ?");
      List<Object> params = new ArrayList<>();
      params.add(Timestamp.from(now));
      if (request.name() != null) { sql.append(", name = ?"); params.add(request.name().trim()); }
      if (request.promoType() != null) { sql.append(", promo_type = ?::promo_type_enum"); params.add(normalizePromotionType(request.promoType())); }
      if (request.valueAmount() != null) { sql.append(", value_amount = ?"); params.add(request.valueAmount()); }
      if (request.valuePercent() != null) { sql.append(", value_percent = ?"); params.add(request.valuePercent()); }
      if (request.minOrderAmount() != null) { sql.append(", min_order_amount = ?"); params.add(request.minOrderAmount()); }
      if (request.maxDiscountAmount() != null) { sql.append(", max_discount_amount = ?"); params.add(request.maxDiscountAmount()); }
      if (request.effectiveFrom() != null) { sql.append(", effective_from = ?"); params.add(Timestamp.from(request.effectiveFrom())); }
      if (request.effectiveTo() != null) { sql.append(", effective_to = ?"); params.add(Timestamp.from(request.effectiveTo())); }
      if (request.status() != null) { sql.append(", status = ?::promo_status_enum"); params.add(request.status().trim()); }
      sql.append(" WHERE id = ?");
      params.add(promotionId);
      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        for (int i = 0; i < params.size(); i++) {
          ps.setObject(i + 1, params.get(i));
        }
        int updated = ps.executeUpdate();
        if (updated == 0) {
          throw ServiceException.notFound("Promotion not found: " + promotionId);
        }
      }
      if (request.outletIds() != null) {
        try (PreparedStatement ps = conn.prepareStatement(
            "DELETE FROM core.promotion_scope WHERE promotion_id = ?"
        )) {
          ps.setLong(1, promotionId);
          ps.executeUpdate();
        }
        for (Long outletId : request.outletIds()) {
          try (PreparedStatement ps = conn.prepareStatement(
              """
              INSERT INTO core.promotion_scope (promotion_id, outlet_id, created_at)
              VALUES (?, ?, ?)
              """
          )) {
            ps.setLong(1, promotionId);
            ps.setLong(2, outletId);
            ps.setTimestamp(3, Timestamp.from(now));
            ps.executeUpdate();
          }
        }
      }
      return findPromotion(conn, promotionId)
          .orElseThrow(() -> new IllegalStateException("Promotion not found after update"));
    });
  }

  private void validatePublicOrderItems(
      Connection conn,
      long outletId,
      LocalDate businessDate,
      List<PublicPosDtos.PublicOrderLineRequest> items
  ) throws Exception {
    Set<Long> productIds = new LinkedHashSet<>();
    for (PublicPosDtos.PublicOrderLineRequest item : items) {
      productIds.add(parsePublicProductId(item.productId()));
    }
    Map<Long, PublicMenuItemRecord> menuItems = listPublicMenuRecords(conn, outletId, businessDate, productIds);
    if (!menuItems.keySet().containsAll(productIds)) {
      throw ServiceException.conflict("One or more requested items are unavailable for this table");
    }
  }

  private void validateStockAvailability(
      Connection conn,
      long outletId,
      Map<Long, AggregatedSaleLine> aggregatedLines,
      boolean lockStockRows,
      String message
  ) throws Exception {
    InventoryPlan plan = buildInventoryPlan(conn, outletId, aggregatedLines, lockStockRows);
    if (!plan.shortages().isEmpty()) {
      throw ServiceException.conflict(message, plan.shortages());
    }
  }

  private InventoryPlan buildInventoryPlan(
      Connection conn,
      long outletId,
      Map<Long, AggregatedSaleLine> aggregatedLines,
      boolean lockStockRows
  ) throws Exception {
    Map<Long, RequirementAccumulator> requirementsByItem = new LinkedHashMap<>();
    List<SaleUsageMovement> movements = new ArrayList<>();
    for (AggregatedSaleLine line : aggregatedLines.values()) {
      for (RecipeComponentRecord component : findLatestActiveRecipeComponents(conn, line.productId())) {
        BigDecimal requiredQty = convertRecipeQuantityToStockUom(
            line.quantity()
                .multiply(component.componentQty())
                .divide(component.yieldQty(), 4, RoundingMode.HALF_UP),
            component.componentUomCode(),
            component.itemBaseUomCode(),
            component.conversionFactor(),
            component.itemCode()
        )
            .setScale(4, RoundingMode.HALF_UP);
        if (requiredQty.compareTo(BigDecimal.ZERO) <= 0) {
          continue;
        }
        movements.add(new SaleUsageMovement(
            line.productId(),
            component.itemId(),
            requiredQty.negate()
        ));
        requirementsByItem
            .computeIfAbsent(
                component.itemId(),
                ignored -> new RequirementAccumulator(component.itemId(), component.itemCode(), component.itemName()))
            .accumulate(requiredQty, line.productId());
      }
    }
    if (requirementsByItem.isEmpty()) {
      return new InventoryPlan(List.of(), List.of());
    }

    Map<Long, BigDecimal> availableByItem = loadStockByItem(
        conn,
        outletId,
        requirementsByItem.keySet(),
        lockStockRows
    );

    List<java.util.Map<String, Object>> shortages = new ArrayList<>();
    for (RequirementAccumulator requirement : requirementsByItem.values()) {
      BigDecimal availableQty = availableByItem.getOrDefault(requirement.itemId(), BigDecimal.ZERO)
          .setScale(4, RoundingMode.HALF_UP);
      if (availableQty.compareTo(requirement.requiredQuantity()) < 0) {
        shortages.add(new LinkedHashMap<>(java.util.Map.of(
            "type", "insufficient_stock",
            "itemId", Long.toString(requirement.itemId()),
            "itemCode", requirement.itemCode(),
            "itemName", requirement.itemName(),
            "requiredQuantity", requirement.requiredQuantity(),
            "availableQuantity", availableQty,
            "shortQuantity", requirement.requiredQuantity().subtract(availableQty),
            "productIds", requirement.productIds().stream().map(String::valueOf).toList()
        )));
      }
    }
    return new InventoryPlan(List.copyOf(movements), List.copyOf(shortages));
  }

  private Map<Long, BigDecimal> loadStockByItem(
      Connection conn,
      long outletId,
      Set<Long> itemIds,
      boolean lockRows
  ) throws Exception {
    StringBuilder sql = new StringBuilder(
        """
        SELECT item_id, qty_on_hand
        FROM core.stock_balance
        WHERE location_id = ?
        """
    );
    List<Object> params = new ArrayList<>();
    params.add(outletId);
    if (!itemIds.isEmpty()) {
      sql.append(" AND item_id IN (");
      boolean first = true;
      for (Long itemId : itemIds) {
        if (!first) {
          sql.append(", ");
        }
        sql.append("?");
        params.add(itemId);
        first = false;
      }
      sql.append(")");
    }
    if (lockRows) {
      sql.append(" FOR UPDATE");
    }
    Map<Long, BigDecimal> availableByItem = new LinkedHashMap<>();
    try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
      bindParams(ps, params);
      try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
          availableByItem.put(rs.getLong("item_id"), rs.getBigDecimal("qty_on_hand"));
        }
      }
    }
    return availableByItem;
  }

  private List<RecipeComponentRecord> findLatestActiveRecipeComponents(Connection conn, long productId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        WITH latest_recipe AS (
          SELECT product_id, version, yield_qty
          FROM core.recipe
          WHERE product_id = ?
            AND status = 'active'
          ORDER BY created_at DESC, version DESC
          LIMIT 1
        )
        SELECT
          lr.product_id,
          lr.yield_qty,
          ri.item_id,
          i.code,
          i.name,
          ri.qty,
          ri.uom_code,
          i.base_uom_code,
          CASE
            WHEN ri.uom_code = i.base_uom_code THEN 1.00000000
            ELSE uc.conversion_factor
          END AS conversion_factor
        FROM latest_recipe lr
        JOIN core.recipe_item ri
          ON ri.product_id = lr.product_id
         AND ri.version = lr.version
        JOIN core.item i ON i.id = ri.item_id
        LEFT JOIN core.uom_conversion uc
          ON uc.from_uom_code = ri.uom_code
         AND uc.to_uom_code = i.base_uom_code
        ORDER BY ri.item_id
        """
    )) {
      ps.setLong(1, productId);
      try (ResultSet rs = ps.executeQuery()) {
        List<RecipeComponentRecord> components = new ArrayList<>();
        while (rs.next()) {
          components.add(new RecipeComponentRecord(
              rs.getLong("product_id"),
              rs.getLong("item_id"),
              rs.getString("code"),
              rs.getString("name"),
              rs.getBigDecimal("qty"),
              rs.getBigDecimal("yield_qty"),
              rs.getString("uom_code"),
              rs.getString("base_uom_code"),
              rs.getBigDecimal("conversion_factor")
          ));
        }
        return List.copyOf(components);
      }
    }
  }

  private List<PublicPosDtos.PublicMenuItemView> listPublicMenu(
      Connection conn,
      long outletId,
      LocalDate businessDate,
      Set<Long> productIds
  ) throws Exception {
    return List.copyOf(listPublicMenuRecords(conn, outletId, businessDate, productIds).values().stream()
        .map(record -> new PublicPosDtos.PublicMenuItemView(
            Long.toString(record.productId()),
            record.code(),
            record.name(),
            record.categoryCode(),
            record.description(),
            record.imageUrl(),
            record.priceValue(),
            record.currencyCode()
        ))
        .toList());
  }

  private Map<Long, PublicMenuItemRecord> listPublicMenuRecords(
      Connection conn,
      long outletId,
      LocalDate businessDate,
      Set<Long> productIds
  ) throws Exception {
    StringBuilder sql = new StringBuilder(
        """
        SELECT
          p.id,
          p.code,
          p.name,
          p.category_code,
          p.description,
          p.image_url,
          price.price_value,
          price.currency_code
        FROM core.product p
        JOIN core.product_outlet_availability availability
          ON availability.product_id = p.id
         AND availability.outlet_id = ?
         AND availability.is_available = TRUE
        JOIN LATERAL (
          SELECT price_value, currency_code
          FROM core.product_price
          WHERE product_id = p.id
            AND outlet_id = ?
            AND effective_from <= ?
            AND (effective_to IS NULL OR effective_to >= ?)
          ORDER BY effective_from DESC
          LIMIT 1
        ) price ON TRUE
        WHERE p.status = 'active'
        """
    );
    List<Object> params = new ArrayList<>();
    params.add(outletId);
    params.add(outletId);
    params.add(businessDate);
    params.add(businessDate);
    if (productIds != null && !productIds.isEmpty()) {
      sql.append(" AND p.id IN (");
      boolean first = true;
      for (Long productId : productIds) {
        if (!first) {
          sql.append(", ");
        }
        sql.append("?");
        params.add(productId);
        first = false;
      }
      sql.append(")");
    }
    sql.append(" ORDER BY COALESCE(p.category_code, 'zzzz'), p.name, p.id");
    try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
      bindParams(ps, params);
      try (ResultSet rs = ps.executeQuery()) {
        Map<Long, PublicMenuItemRecord> rows = new LinkedHashMap<>();
        while (rs.next()) {
          PublicMenuItemRecord record = mapPublicMenuItemRecord(rs);
          rows.put(record.productId(), record);
        }
        return rows;
      }
    }
  }

  private Map<Long, AggregatedSaleLine> aggregateLines(
      Connection conn,
      SalesDtos.SubmitSaleRequest request,
      LocalDate businessDate
  ) throws Exception {
    Map<Long, AggregatedSaleLine> aggregated = new LinkedHashMap<>();
    for (SalesDtos.SaleLineRequest line : request.items()) {
      BigDecimal unitPrice = resolveUnitPrice(conn, line.productId(), request.outletId(), businessDate);
      AggregatedSaleLine current = aggregated.get(line.productId());
      Set<Long> promotionIds = line.promotionIds() == null ? Set.of() : Set.copyOf(line.promotionIds());
      if (current == null) {
        aggregated.put(line.productId(), new AggregatedSaleLine(
            line.productId(),
            line.quantity(),
            unitPrice,
            money(line.discountAmount()),
            money(line.taxAmount()),
            promotionIds,
            trimToNull(line.note())
        ));
      } else {
        Set<Long> mergedPromotionIds = new LinkedHashSet<>(current.promotionIds());
        mergedPromotionIds.addAll(promotionIds);
        aggregated.put(line.productId(), new AggregatedSaleLine(
            line.productId(),
            current.quantity().add(line.quantity()),
            unitPrice,
            current.discountAmount().add(money(line.discountAmount())),
            current.taxAmount().add(money(line.taxAmount())),
            Set.copyOf(mergedPromotionIds),
            current.note()
        ));
      }
    }
    return aggregated;
  }

  private void insertSaleItems(Connection conn, long saleId, Iterable<AggregatedSaleLine> lines, Instant now)
      throws Exception {
    for (AggregatedSaleLine line : lines) {
      BigDecimal lineTotal = line.unitPrice()
          .multiply(line.quantity())
          .subtract(line.discountAmount())
          .add(line.taxAmount())
          .setScale(2, RoundingMode.HALF_UP);
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.sale_item (
            sale_id, product_id, unit_price, qty, discount_amount, tax_amount, line_total, note, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          """
      )) {
        ps.setLong(1, saleId);
        ps.setLong(2, line.productId());
        ps.setBigDecimal(3, line.unitPrice());
        ps.setBigDecimal(4, line.quantity());
        ps.setBigDecimal(5, line.discountAmount().setScale(2, RoundingMode.HALF_UP));
        ps.setBigDecimal(6, line.taxAmount().setScale(2, RoundingMode.HALF_UP));
        ps.setBigDecimal(7, lineTotal);
        ps.setString(8, line.note());
        ps.setTimestamp(9, Timestamp.from(now));
        ps.setTimestamp(10, Timestamp.from(now));
        ps.executeUpdate();
      }
    }
  }

  private void insertSalePromotions(Connection conn, long saleId, Iterable<AggregatedSaleLine> lines, Instant now)
      throws Exception {
    for (AggregatedSaleLine line : lines) {
      for (Long promotionId : line.promotionIds()) {
        try (PreparedStatement ps = conn.prepareStatement(
            """
            INSERT INTO core.sale_item_promotion (sale_id, product_id, promotion_id, created_at)
            VALUES (?, ?, ?, ?)
            """
        )) {
          ps.setLong(1, saleId);
          ps.setLong(2, line.productId());
          ps.setLong(3, promotionId);
          ps.setTimestamp(4, Timestamp.from(now));
          ps.executeUpdate();
        }
      }
    }
  }

  private void upsertPayment(
      Connection conn,
      long saleId,
      Long posSessionId,
      SalesDtos.MarkPaymentDoneRequest payment,
      BigDecimal totalAmount,
      Instant paymentTime
  ) throws Exception {
    Instant now = clock.instant();
    boolean paymentExists = loadPaymentTransactional(conn, saleId).isPresent();
    if (paymentExists) {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          UPDATE core.payment
          SET pos_session_id = ?,
              payment_method = ?::payment_method_enum,
              amount = ?,
              status = 'success'::payment_txn_status_enum,
              payment_time = ?,
              transaction_ref = ?,
              note = ?,
              updated_at = ?
          WHERE sale_id = ?
          """
      )) {
        if (posSessionId == null) {
          ps.setNull(1, java.sql.Types.BIGINT);
        } else {
          ps.setLong(1, posSessionId);
        }
        ps.setString(2, payment.paymentMethod().trim());
        ps.setBigDecimal(3, totalAmount);
        ps.setTimestamp(4, Timestamp.from(paymentTime));
        ps.setString(5, trimToNull(payment.transactionRef()));
        ps.setString(6, trimToNull(payment.note()));
        ps.setTimestamp(7, Timestamp.from(now));
        ps.setLong(8, saleId);
        ps.executeUpdate();
      }
      return;
    }
    try (PreparedStatement ps = conn.prepareStatement(
        """
        INSERT INTO core.payment (
          sale_id, pos_session_id, payment_method, amount, status, payment_time, transaction_ref, note, created_at, updated_at
        ) VALUES (?, ?, ?::payment_method_enum, ?, ?::payment_txn_status_enum, ?, ?, ?, ?, ?)
        """
    )) {
      ps.setLong(1, saleId);
      if (posSessionId == null) {
        ps.setNull(2, java.sql.Types.BIGINT);
      } else {
        ps.setLong(2, posSessionId);
      }
      ps.setString(3, payment.paymentMethod().trim());
      ps.setBigDecimal(4, totalAmount);
      ps.setString(5, "success");
      ps.setTimestamp(6, Timestamp.from(paymentTime));
      ps.setString(7, trimToNull(payment.transactionRef()));
      ps.setString(8, trimToNull(payment.note()));
      ps.setTimestamp(9, Timestamp.from(now));
      ps.setTimestamp(10, Timestamp.from(now));
      ps.executeUpdate();
    }
  }

  private Map<Long, AggregatedSaleLine> loadSaleLinesForInventory(Connection conn, long saleId) throws Exception {
    Map<Long, AggregatedSaleLine> aggregated = new LinkedHashMap<>();
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT product_id, qty, unit_price, discount_amount, tax_amount, note
        FROM core.sale_item
        WHERE sale_id = ?
        ORDER BY product_id
        """
    )) {
      ps.setLong(1, saleId);
      try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
          long productId = rs.getLong("product_id");
          aggregated.put(productId, new AggregatedSaleLine(
              productId,
              rs.getBigDecimal("qty"),
              rs.getBigDecimal("unit_price"),
              rs.getBigDecimal("discount_amount"),
              rs.getBigDecimal("tax_amount"),
              loadPromotionIdsTransactional(conn, saleId, productId),
              rs.getString("note")
          ));
        }
      }
    }
    return aggregated;
  }

  private void applyInventoryUsageForSale(
      Connection conn,
      long saleId,
      long outletId,
      LocalDate businessDate,
      Long actorUserId,
      Map<Long, AggregatedSaleLine> aggregatedLines
  ) throws Exception {
    InventoryPlan plan = buildInventoryPlan(conn, outletId, aggregatedLines, false);
    Instant txnTime = clock.instant();
    for (SaleUsageMovement movement : plan.movements()) {
      if (saleItemTransactionExists(conn, saleId, movement.productId(), movement.itemId())) {
        continue;
      }
      long inventoryTransactionId = snowflakeIdGenerator.generateId();
      insertInventoryTransaction(
          conn,
          inventoryTransactionId,
          outletId,
          movement.itemId(),
          movement.qtyChange(),
          businessDate,
          txnTime,
          actorUserId,
          "Sale approval " + saleId + " product " + movement.productId()
      );
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.sale_item_transaction (
            inventory_transaction_id, sale_id, product_id, item_id
          ) VALUES (?, ?, ?, ?)
          """
      )) {
        ps.setLong(1, inventoryTransactionId);
        ps.setLong(2, saleId);
        ps.setLong(3, movement.productId());
        ps.setLong(4, movement.itemId());
        ps.executeUpdate();
      }
    }
  }

  private boolean saleItemTransactionExists(Connection conn, long saleId, long productId, long itemId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT 1
        FROM core.sale_item_transaction
        WHERE sale_id = ?
          AND product_id = ?
          AND item_id = ?
        """
    )) {
      ps.setLong(1, saleId);
      ps.setLong(2, productId);
      ps.setLong(3, itemId);
      try (ResultSet rs = ps.executeQuery()) {
        return rs.next();
      }
    }
  }

  private void insertInventoryTransaction(
      Connection conn,
      long inventoryTransactionId,
      long outletId,
      long itemId,
      BigDecimal qtyChange,
      LocalDate businessDate,
      Instant txnTime,
      Long actorUserId,
      String note
  ) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        INSERT INTO core.inventory_transaction (
          id, outlet_id, item_id, qty_change, business_date, txn_time, txn_type, unit_cost, created_by_user_id, note
        ) VALUES (?, ?, ?, ?, ?, ?, 'sale_usage'::inventory_txn_type_enum, ?, ?, ?)
        """
    )) {
      ps.setLong(1, inventoryTransactionId);
      ps.setLong(2, outletId);
      ps.setLong(3, itemId);
      ps.setBigDecimal(4, qtyChange.setScale(4, RoundingMode.HALF_UP));
      ps.setObject(5, businessDate);
      ps.setTimestamp(6, Timestamp.from(txnTime));
      ps.setBigDecimal(7, currentUnitCost(conn, outletId, itemId));
      if (actorUserId == null) {
        ps.setNull(8, java.sql.Types.BIGINT);
      } else {
        ps.setLong(8, actorUserId);
      }
      ps.setString(9, trimToNull(note));
      ps.executeUpdate();
    }
  }

  private BigDecimal currentUnitCost(Connection conn, long outletId, long itemId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT unit_cost
        FROM core.stock_balance
        WHERE location_id = ?
          AND item_id = ?
        """
    )) {
      ps.setLong(1, outletId);
      ps.setLong(2, itemId);
      try (ResultSet rs = ps.executeQuery()) {
        if (rs.next()) {
          return rs.getBigDecimal("unit_cost");
        }
        return null;
      }
    }
  }

  private Optional<LockedPosSessionRecord> lockPosSession(Connection conn, long sessionId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT id, outlet_id, session_code, business_date, opened_at, closed_at, status, note
        FROM core.pos_session
        WHERE id = ?
        FOR UPDATE
        """
    )) {
      ps.setLong(1, sessionId);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) {
          return Optional.empty();
        }
        Timestamp closedAt = rs.getTimestamp("closed_at");
        return Optional.of(new LockedPosSessionRecord(
            rs.getLong("id"),
            rs.getLong("outlet_id"),
            rs.getString("session_code"),
            rs.getObject("business_date", LocalDate.class),
            rs.getTimestamp("opened_at").toInstant(),
            closedAt == null ? null : closedAt.toInstant(),
            rs.getString("status"),
            rs.getString("note")
        ));
      }
    }
  }

  private Map<String, BigDecimal> loadExpectedPaymentTotalsByMethod(Connection conn, long sessionId) throws Exception {
    Map<String, BigDecimal> totals = new LinkedHashMap<>();
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT payment_method, COALESCE(SUM(amount), 0) AS total_amount
        FROM core.payment
        WHERE pos_session_id = ?
          AND status = 'success'::payment_txn_status_enum
        GROUP BY payment_method
        ORDER BY payment_method
        """
    )) {
      ps.setLong(1, sessionId);
      try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
          totals.put(
              rs.getString("payment_method"),
              money(rs.getBigDecimal("total_amount")).setScale(2, RoundingMode.HALF_UP)
          );
        }
      }
    }
    return totals;
  }

  private Map<String, BigDecimal> resolveActualPaymentTotals(
      List<SalesDtos.ReconcilePosSessionLineRequest> requestLines,
      Map<String, BigDecimal> expectedByMethod
  ) {
    Map<String, BigDecimal> actualByMethod = new LinkedHashMap<>();
    if (requestLines == null || requestLines.isEmpty()) {
      actualByMethod.putAll(expectedByMethod);
      return actualByMethod;
    }
    for (SalesDtos.ReconcilePosSessionLineRequest line : requestLines) {
      String paymentMethod = normalizePaymentMethod(line.paymentMethod());
      if (actualByMethod.containsKey(paymentMethod)) {
        throw ServiceException.badRequest("Duplicate payment method in reconciliation payload: " + paymentMethod);
      }
      actualByMethod.put(paymentMethod, money(line.actualAmount()).setScale(2, RoundingMode.HALF_UP));
    }
    for (Map.Entry<String, BigDecimal> entry : expectedByMethod.entrySet()) {
      actualByMethod.putIfAbsent(entry.getKey(), entry.getValue().setScale(2, RoundingMode.HALF_UP));
    }
    return actualByMethod;
  }

  private List<SalesDtos.PosSessionReconciliationLineView> buildReconciliationLines(
      Map<String, BigDecimal> expectedByMethod,
      Map<String, BigDecimal> actualByMethod
  ) {
    Set<String> methods = new TreeSet<>();
    methods.addAll(expectedByMethod.keySet());
    methods.addAll(actualByMethod.keySet());
    List<SalesDtos.PosSessionReconciliationLineView> lines = new ArrayList<>();
    for (String method : methods) {
      BigDecimal expectedAmount = money(expectedByMethod.get(method)).setScale(2, RoundingMode.HALF_UP);
      BigDecimal actualAmount = money(actualByMethod.get(method)).setScale(2, RoundingMode.HALF_UP);
      BigDecimal discrepancyAmount = actualAmount.subtract(expectedAmount).setScale(2, RoundingMode.HALF_UP);
      lines.add(new SalesDtos.PosSessionReconciliationLineView(
          method,
          expectedAmount,
          actualAmount,
          discrepancyAmount
      ));
    }
    return List.copyOf(lines);
  }

  private void upsertPosSessionReconciliation(
      Connection conn,
      long sessionId,
      Long actorUserId,
      Instant reconciledAt,
      BigDecimal expectedTotal,
      BigDecimal actualTotal,
      BigDecimal discrepancyTotal,
      String note,
      List<SalesDtos.PosSessionReconciliationLineView> lines
  ) throws Exception {
    Timestamp now = Timestamp.from(reconciledAt);
    try (PreparedStatement ps = conn.prepareStatement(
        """
        INSERT INTO core.pos_session_reconciliation (
          session_id, reconciled_by_user_id, reconciled_at, expected_total, actual_total, discrepancy_total, note, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (session_id)
        DO UPDATE SET
          reconciled_by_user_id = EXCLUDED.reconciled_by_user_id,
          reconciled_at = EXCLUDED.reconciled_at,
          expected_total = EXCLUDED.expected_total,
          actual_total = EXCLUDED.actual_total,
          discrepancy_total = EXCLUDED.discrepancy_total,
          note = EXCLUDED.note,
          updated_at = EXCLUDED.updated_at
        """
    )) {
      ps.setLong(1, sessionId);
      if (actorUserId == null) {
        ps.setNull(2, java.sql.Types.BIGINT);
      } else {
        ps.setLong(2, actorUserId);
      }
      ps.setTimestamp(3, now);
      ps.setBigDecimal(4, expectedTotal);
      ps.setBigDecimal(5, actualTotal);
      ps.setBigDecimal(6, discrepancyTotal);
      ps.setString(7, note);
      ps.setTimestamp(8, now);
      ps.setTimestamp(9, now);
      ps.executeUpdate();
    }

    try (PreparedStatement ps = conn.prepareStatement(
        "DELETE FROM core.pos_session_reconciliation_line WHERE session_id = ?"
    )) {
      ps.setLong(1, sessionId);
      ps.executeUpdate();
    }

    for (SalesDtos.PosSessionReconciliationLineView line : lines) {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.pos_session_reconciliation_line (
            session_id, payment_method, expected_amount, actual_amount, discrepancy_amount, created_at, updated_at
          ) VALUES (?, ?::payment_method_enum, ?, ?, ?, ?, ?)
          """
      )) {
        ps.setLong(1, sessionId);
        ps.setString(2, line.paymentMethod());
        ps.setBigDecimal(3, line.expectedAmount());
        ps.setBigDecimal(4, line.actualAmount());
        ps.setBigDecimal(5, line.discrepancyAmount());
        ps.setTimestamp(6, now);
        ps.setTimestamp(7, now);
        ps.executeUpdate();
      }
    }
  }

  private Optional<SalesDtos.PosSessionReconciliationView> loadPosSessionReconciliation(Connection conn, long sessionId)
      throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT
          ps.id,
          ps.session_code,
          ps.outlet_id,
          ps.business_date,
          ps.status,
          ps.opened_at,
          ps.closed_at,
          ps.note AS session_note,
          pr.reconciled_at,
          pr.expected_total,
          pr.actual_total,
          pr.discrepancy_total,
          pr.note AS reconciliation_note
        FROM core.pos_session ps
        LEFT JOIN core.pos_session_reconciliation pr ON pr.session_id = ps.id
        WHERE ps.id = ?
        """
    )) {
      ps.setLong(1, sessionId);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) {
          return Optional.empty();
        }
        Timestamp closedAt = rs.getTimestamp("closed_at");
        Timestamp reconciledAt = rs.getTimestamp("reconciled_at");
        String note = rs.getString("reconciliation_note");
        if (note == null) {
          note = rs.getString("session_note");
        }
        return Optional.of(new SalesDtos.PosSessionReconciliationView(
            Long.toString(rs.getLong("id")),
            rs.getString("session_code"),
            rs.getLong("outlet_id"),
            rs.getObject("business_date", LocalDate.class),
            rs.getString("status"),
            rs.getTimestamp("opened_at").toInstant(),
            closedAt == null ? null : closedAt.toInstant(),
            reconciledAt == null ? null : reconciledAt.toInstant(),
            money(rs.getBigDecimal("expected_total")).setScale(2, RoundingMode.HALF_UP),
            money(rs.getBigDecimal("actual_total")).setScale(2, RoundingMode.HALF_UP),
            money(rs.getBigDecimal("discrepancy_total")).setScale(2, RoundingMode.HALF_UP),
            note,
            loadPosSessionReconciliationLines(conn, sessionId)
        ));
      }
    }
  }

  private List<SalesDtos.PosSessionReconciliationLineView> loadPosSessionReconciliationLines(
      Connection conn,
      long sessionId
  ) throws Exception {
    List<SalesDtos.PosSessionReconciliationLineView> lines = new ArrayList<>();
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT payment_method, expected_amount, actual_amount, discrepancy_amount
        FROM core.pos_session_reconciliation_line
        WHERE session_id = ?
        ORDER BY payment_method
        """
    )) {
      ps.setLong(1, sessionId);
      try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
          lines.add(new SalesDtos.PosSessionReconciliationLineView(
              rs.getString("payment_method"),
              money(rs.getBigDecimal("expected_amount")).setScale(2, RoundingMode.HALF_UP),
              money(rs.getBigDecimal("actual_amount")).setScale(2, RoundingMode.HALF_UP),
              money(rs.getBigDecimal("discrepancy_amount")).setScale(2, RoundingMode.HALF_UP)
          ));
        }
      }
    }
    return List.copyOf(lines);
  }

  private Optional<LockedSaleRecord> lockSale(Connection conn, long saleId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT id, outlet_id, pos_session_id, status, total_amount, created_at, note
        FROM core.sale_record
        WHERE id = ?
        FOR UPDATE
        """
    )) {
      ps.setLong(1, saleId);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) {
          return Optional.empty();
        }
        Object posSessionId = rs.getObject("pos_session_id");
        return Optional.of(new LockedSaleRecord(
            rs.getLong("id"),
            rs.getLong("outlet_id"),
            posSessionId == null ? null : ((Number) posSessionId).longValue(),
            rs.getString("status"),
            rs.getBigDecimal("total_amount"),
            rs.getTimestamp("created_at").toInstant().atZone(java.time.ZoneOffset.UTC).toLocalDate(),
            rs.getString("note")
        ));
      }
    }
  }

  private static boolean isApprovableStatus(String status) {
    return "order_created".equalsIgnoreCase(status) || "open".equalsIgnoreCase(status);
  }

  private static boolean isCancellableStatus(String status) {
    return "order_created".equalsIgnoreCase(status) || "open".equalsIgnoreCase(status);
  }

  private String readPaymentStatus(Connection conn, long saleId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        "SELECT payment_status FROM core.sale_record WHERE id = ?"
    )) {
      ps.setLong(1, saleId);
      try (ResultSet rs = ps.executeQuery()) {
        return rs.next() ? rs.getString(1) : null;
      }
    }
  }

  private static boolean isNegativeStockViolation(java.sql.SQLException exception) {
    return "23514".equals(exception.getSQLState());
  }

  private Optional<SalesDtos.PosSessionView> findPosSession(Connection conn, long sessionId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT id, session_code, outlet_id, currency_code, manager_id, opened_at, closed_at, business_date, status, note
        FROM core.pos_session
        WHERE id = ?
        """
    )) {
      ps.setLong(1, sessionId);
      try (ResultSet rs = ps.executeQuery()) {
        if (rs.next()) {
          return Optional.of(mapPosSession(rs));
        }
        return Optional.empty();
      }
    }
  }

  private Optional<SalesDtos.SaleView> findSale(Connection conn, long saleId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT
          sr.id,
          sr.outlet_id,
          sr.pos_session_id,
          sr.public_token,
          t.table_code,
          t.display_name,
          sr.currency_code,
          sr.order_type,
          sr.status,
          sr.payment_status,
          sr.subtotal,
          sr.discount,
          sr.tax_amount,
          sr.total_amount,
          sr.note,
          sr.created_at
        FROM core.sale_record sr
        LEFT JOIN core.ordering_table t ON t.id = sr.ordering_table_id
        WHERE sr.id = ?
        """
    )) {
      ps.setLong(1, saleId);
      try (ResultSet rs = ps.executeQuery()) {
        if (rs.next()) {
          return Optional.of(mapSaleHeader(
              rs,
              loadSaleItemsTransactional(conn, saleId),
              loadPaymentTransactional(conn, saleId).orElse(null)
          ));
        }
        return Optional.empty();
      }
    }
  }

  private Optional<SalesDtos.PromotionView> findPromotion(Connection conn, long promotionId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT id, name, promo_type, status, value_amount, value_percent, effective_from, effective_to
        FROM core.promotion
        WHERE id = ?
        """
    )) {
      ps.setLong(1, promotionId);
      try (ResultSet rs = ps.executeQuery()) {
        if (rs.next()) {
          return Optional.of(new SalesDtos.PromotionView(
              Long.toString(rs.getLong("id")),
              rs.getString("name"),
              rs.getString("promo_type"),
              rs.getString("status"),
              rs.getBigDecimal("value_amount"),
              rs.getBigDecimal("value_percent"),
              rs.getTimestamp("effective_from").toInstant(),
              rs.getTimestamp("effective_to") == null ? null : rs.getTimestamp("effective_to").toInstant(),
              loadPromotionScopes(conn, promotionId)
          ));
        }
        return Optional.empty();
      }
    }
  }

  private SalesDtos.PromotionView mapPromotion(ResultSet rs, Connection conn) throws Exception {
    long promotionId = rs.getLong("id");
    return new SalesDtos.PromotionView(
        Long.toString(promotionId),
        rs.getString("name"),
        rs.getString("promo_type"),
        rs.getString("status"),
        rs.getBigDecimal("value_amount"),
        rs.getBigDecimal("value_percent"),
        rs.getTimestamp("effective_from").toInstant(),
        rs.getTimestamp("effective_to") == null ? null : rs.getTimestamp("effective_to").toInstant(),
        loadPromotionScopes(conn, promotionId)
    );
  }

  private Set<Long> loadPromotionScopes(Connection conn, long promotionId) throws Exception {
    Set<Long> outletIds = new LinkedHashSet<>();
    try (PreparedStatement ps = conn.prepareStatement(
        "SELECT outlet_id FROM core.promotion_scope WHERE promotion_id = ? ORDER BY outlet_id"
    )) {
      ps.setLong(1, promotionId);
      try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
          outletIds.add(rs.getLong("outlet_id"));
        }
      }
    }
    return Set.copyOf(outletIds);
  }

  private List<SalesDtos.SaleLineView> loadSaleItems(long saleId) {
    return queryList(
        """
        SELECT si.sale_id, si.product_id, p.code AS product_code, p.name AS product_name,
               si.unit_price, si.qty, si.discount_amount, si.tax_amount, si.line_total, si.note
        FROM core.sale_item si
        LEFT JOIN core.product p ON p.id = si.product_id
        WHERE si.sale_id = ?
        ORDER BY si.product_id
        """,
        rs -> mapSaleLine(rs, loadPromotionIds(saleId, getLong(rs, "product_id"))),
        saleId
    );
  }

  private List<SalesDtos.SaleLineView> loadSaleItemsTransactional(Connection conn, long saleId) throws Exception {
    List<SalesDtos.SaleLineView> items = new ArrayList<>();
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT si.sale_id, si.product_id, p.code AS product_code, p.name AS product_name,
               si.unit_price, si.qty, si.discount_amount, si.tax_amount, si.line_total, si.note
        FROM core.sale_item si
        LEFT JOIN core.product p ON p.id = si.product_id
        WHERE si.sale_id = ?
        ORDER BY si.product_id
        """
    )) {
      ps.setLong(1, saleId);
      try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
          items.add(mapSaleLine(rs, loadPromotionIdsTransactional(conn, saleId, rs.getLong("product_id"))));
        }
      }
    }
    return List.copyOf(items);
  }

  private Optional<SalesDtos.PaymentView> loadPayment(long saleId) {
    return queryOne(
        """
        SELECT sale_id, payment_method, amount, status, payment_time, transaction_ref, note
        FROM core.payment
        WHERE sale_id = ?
        """,
        this::mapPayment,
        saleId
    );
  }

  private Optional<SalesDtos.PaymentView> loadPaymentTransactional(Connection conn, long saleId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT sale_id, payment_method, amount, status, payment_time, transaction_ref, note
        FROM core.payment
        WHERE sale_id = ?
        """
    )) {
      ps.setLong(1, saleId);
      try (ResultSet rs = ps.executeQuery()) {
        if (rs.next()) {
          return Optional.of(mapPayment(rs));
        }
        return Optional.empty();
      }
    }
  }

  private Set<Long> loadPromotionIds(long saleId, long productId) {
    List<Long> ids = queryList(
        """
        SELECT promotion_id
        FROM core.sale_item_promotion
        WHERE sale_id = ? AND product_id = ?
        ORDER BY promotion_id
        """,
        rs -> getLong(rs, "promotion_id"),
        saleId,
        productId
    );
    return Set.copyOf(ids);
  }

  private Set<Long> loadPromotionIdsTransactional(Connection conn, long saleId, long productId) throws Exception {
    Set<Long> promotionIds = new LinkedHashSet<>();
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT promotion_id
        FROM core.sale_item_promotion
        WHERE sale_id = ? AND product_id = ?
        ORDER BY promotion_id
        """
    )) {
      ps.setLong(1, saleId);
      ps.setLong(2, productId);
      try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
          promotionIds.add(rs.getLong("promotion_id"));
        }
      }
    }
    return Set.copyOf(promotionIds);
  }

  private BigDecimal resolveUnitPrice(Connection conn, long productId, long outletId, LocalDate businessDate)
      throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT price_value
        FROM core.product_price
        WHERE product_id = ?
          AND outlet_id = ?
          AND effective_from <= ?
          AND (effective_to IS NULL OR effective_to >= ?)
        ORDER BY effective_from DESC
        LIMIT 1
        """
    )) {
      ps.setLong(1, productId);
      ps.setLong(2, outletId);
      ps.setObject(3, businessDate);
      ps.setObject(4, businessDate);
      try (ResultSet rs = ps.executeQuery()) {
        if (rs.next()) {
          return rs.getBigDecimal("price_value");
        }
      }
    }
    throw ServiceException.notFound("No effective product price for product " + productId + " at outlet " + outletId);
  }

  private SalesDtos.PosSessionView mapPosSession(ResultSet rs) {
    try {
      Timestamp closedAt = rs.getTimestamp("closed_at");
      return new SalesDtos.PosSessionView(
          Long.toString(rs.getLong("id")),
          rs.getString("session_code"),
          rs.getLong("outlet_id"),
          rs.getString("currency_code"),
          rs.getLong("manager_id"),
          rs.getTimestamp("opened_at").toInstant(),
          closedAt == null ? null : closedAt.toInstant(),
          rs.getObject("business_date", LocalDate.class),
          rs.getString("status"),
          rs.getString("note")
      );
    } catch (Exception e) {
      throw new IllegalStateException("Unable to map POS session", e);
    }
  }

  private SalesDtos.PosSessionListItemView mapPosSessionListItem(ResultSet rs) {
    try {
      Timestamp closedAt = rs.getTimestamp("closed_at");
      return new SalesDtos.PosSessionListItemView(
          Long.toString(rs.getLong("id")),
          rs.getString("session_code"),
          rs.getLong("outlet_id"),
          rs.getString("currency_code"),
          rs.getLong("manager_id"),
          rs.getTimestamp("opened_at").toInstant(),
          closedAt == null ? null : closedAt.toInstant(),
          rs.getObject("business_date", LocalDate.class),
          rs.getString("status"),
          rs.getString("note"),
          rs.getLong("order_count"),
          rs.getBigDecimal("total_revenue")
      );
    } catch (Exception e) {
      throw new IllegalStateException("Unable to map POS session list item", e);
    }
  }

  private SalesDtos.SaleView mapSaleHeader(
      ResultSet rs,
      List<SalesDtos.SaleLineView> items,
      SalesDtos.PaymentView payment
  ) {
    try {
      Object posSessionId = rs.getObject("pos_session_id");
      return new SalesDtos.SaleView(
          Long.toString(rs.getLong("id")),
          rs.getLong("outlet_id"),
          posSessionId == null ? null : Long.toString(((Number) posSessionId).longValue()),
          rs.getString("public_token"),
          rs.getString("table_code"),
          rs.getString("display_name"),
          rs.getString("currency_code"),
          rs.getString("order_type"),
          rs.getString("status"),
          rs.getString("payment_status"),
          rs.getBigDecimal("subtotal"),
          rs.getBigDecimal("discount"),
          rs.getBigDecimal("tax_amount"),
          rs.getBigDecimal("total_amount"),
          rs.getString("note"),
          items,
          payment,
          rs.getTimestamp("created_at").toInstant()
      );
    } catch (Exception e) {
      throw new IllegalStateException("Unable to map sale header", e);
    }
  }

  private SalesDtos.SaleListItemView mapSaleListItem(ResultSet rs) {
    try {
      Object posSessionId = rs.getObject("pos_session_id");
      return new SalesDtos.SaleListItemView(
          Long.toString(rs.getLong("id")),
          rs.getLong("outlet_id"),
          posSessionId == null ? null : Long.toString(((Number) posSessionId).longValue()),
          rs.getString("public_token"),
          rs.getString("table_code"),
          rs.getString("display_name"),
          rs.getString("currency_code"),
          rs.getString("order_type"),
          rs.getString("status"),
          rs.getString("payment_status"),
          rs.getBigDecimal("subtotal"),
          rs.getBigDecimal("discount"),
          rs.getBigDecimal("tax_amount"),
          rs.getBigDecimal("total_amount"),
          rs.getString("note"),
          rs.getTimestamp("created_at").toInstant()
      );
    } catch (Exception e) {
      throw new IllegalStateException("Unable to map sale list item", e);
    }
  }

  private SalesDtos.SaleLineView mapSaleLine(ResultSet rs, Set<Long> promotionIds) {
    try {
      return new SalesDtos.SaleLineView(
          rs.getLong("product_id"),
          rs.getString("product_code"),
          rs.getString("product_name"),
          rs.getBigDecimal("qty"),
          rs.getBigDecimal("unit_price"),
          rs.getBigDecimal("discount_amount"),
          rs.getBigDecimal("tax_amount"),
          rs.getBigDecimal("line_total"),
          promotionIds,
          rs.getString("note")
      );
    } catch (Exception e) {
      throw new IllegalStateException("Unable to map sale line", e);
    }
  }

  private SalesDtos.PaymentView mapPayment(ResultSet rs) {
    try {
      return new SalesDtos.PaymentView(
          Long.toString(rs.getLong("sale_id")),
          rs.getString("payment_method"),
          rs.getBigDecimal("amount"),
          rs.getString("status"),
          rs.getTimestamp("payment_time").toInstant(),
          rs.getString("transaction_ref"),
          rs.getString("note")
      );
    } catch (Exception e) {
      throw new IllegalStateException("Unable to map payment", e);
    }
  }

  private PublicOrderingTableRecord mapPublicOrderingTable(ResultSet rs) {
    try {
      return new PublicOrderingTableRecord(
          rs.getLong("id"),
          rs.getLong("outlet_id"),
          rs.getString("table_code"),
          rs.getString("display_name"),
          rs.getString("public_token"),
          rs.getString("status"),
          rs.getString("outlet_code"),
          rs.getString("outlet_name"),
          rs.getString("outlet_status"),
          rs.getString("currency_code"),
          rs.getString("timezone_name")
      );
    } catch (Exception e) {
      throw new IllegalStateException("Unable to map ordering table", e);
    }
  }

  private PublicMenuItemRecord mapPublicMenuItemRecord(ResultSet rs) {
    try {
      return new PublicMenuItemRecord(
          rs.getLong("id"),
          rs.getString("code"),
          rs.getString("name"),
          rs.getString("category_code"),
          rs.getString("description"),
          rs.getString("image_url"),
          rs.getBigDecimal("price_value"),
          rs.getString("currency_code")
      );
    } catch (Exception e) {
      throw new IllegalStateException("Unable to map public menu item", e);
    }
  }

  private static String resolvePaymentStatus(SalesDtos.PaymentRequest payment, BigDecimal totalAmount) {
    if (payment == null) {
      return "unpaid";
    }
    String txnStatus = normalizePaymentTxnStatus(payment.status());
    if (!"success".equalsIgnoreCase(txnStatus)) {
      return "unpaid";
    }
    if (payment.amount().compareTo(totalAmount) >= 0) {
      return "paid";
    }
    return "partially_paid";
  }

  private static String normalizeOrderType(String orderType) {
    if (orderType == null || orderType.isBlank()) {
      return "dine_in";
    }
    return orderType.trim();
  }

  private static String normalizePaymentTxnStatus(String status) {
    if (status == null || status.isBlank()) {
      return "success";
    }
    return status.trim();
  }

  private static String normalizePaymentMethod(String paymentMethod) {
    if (paymentMethod == null || paymentMethod.isBlank()) {
      throw ServiceException.badRequest("paymentMethod is required");
    }
    String normalized = paymentMethod.trim().toLowerCase(Locale.ROOT)
        .replace('-', '_')
        .replace(' ', '_');
    return switch (normalized) {
      case "cash" -> "cash";
      case "card" -> "card";
      case "ewallet", "e_wallet" -> "ewallet";
      case "bank_transfer", "banktransfer" -> "bank_transfer";
      case "voucher" -> "voucher";
      default -> throw ServiceException.badRequest("Unsupported paymentMethod: " + paymentMethod);
    };
  }

  static BigDecimal convertRecipeQuantityToStockUom(
      BigDecimal requiredQty,
      String componentUomCode,
      String itemBaseUomCode,
      BigDecimal conversionFactor,
      String itemCode
  ) {
    if (requiredQty == null || requiredQty.compareTo(BigDecimal.ZERO) <= 0) {
      return BigDecimal.ZERO.setScale(4, RoundingMode.HALF_UP);
    }
    if (componentUomCode == null
        || itemBaseUomCode == null
        || componentUomCode.isBlank()
        || itemBaseUomCode.isBlank()) {
      throw ServiceException.badRequest(
          "Recipe or item is missing unit-of-measure configuration for item " + itemCode);
    }
    if (componentUomCode.equals(itemBaseUomCode)) {
      return requiredQty;
    }
    if (conversionFactor == null || conversionFactor.compareTo(BigDecimal.ZERO) <= 0) {
      throw ServiceException.badRequest(
          "Missing unit conversion from " + componentUomCode
              + " to " + itemBaseUomCode
              + " for item " + itemCode);
    }
    return requiredQty.multiply(conversionFactor);
  }

  private static String mergeReconciliationNote(String existingNote, String reconciliationNote) {
    String incoming = trimToNull(reconciliationNote);
    if (incoming == null) {
      return null;
    }
    String existing = trimToNull(existingNote);
    if (existing == null) {
      return incoming;
    }
    if (existing.equals(incoming)) {
      return existing;
    }
    return existing + " | Reconciliation: " + incoming;
  }

  private static String buildCancellationNote(String existingNote, String reason, Long actorUserId) {
    String cancelReason = trimToNull(reason);
    if (cancelReason == null) {
      return null;
    }
    String prefix = actorUserId == null
        ? "Cancelled"
        : "Cancelled by user " + actorUserId;
    String entry = prefix + ": " + cancelReason;
    String existing = trimToNull(existingNote);
    if (existing == null) {
      return entry;
    }
    if (existing.contains(entry)) {
      return existing;
    }
    return existing + " | " + entry;
  }

  private static String normalizePromotionType(String promoType) {
    if (promoType == null || promoType.isBlank()) {
      throw ServiceException.badRequest("promoType is required");
    }
    String normalized = promoType.trim().toLowerCase(Locale.ROOT).replace('-', '_');
    return switch (normalized) {
      case "percentage", "percent", "discount_percent" -> "percentage";
      case "fixed_amount", "fixed", "amount", "discount_fixed" -> "fixed_amount";
      case "buy_x_get_y", "bogo" -> "buy_x_get_y";
      case "combo_price", "combo" -> "combo_price";
      case "subsidy" -> "subsidy";
      default -> throw ServiceException.badRequest("Unsupported promoType: " + promoType);
    };
  }

  private static String resolvePromotionStatusForCreate(Instant effectiveFrom, Instant now) {
    return effectiveFrom != null && effectiveFrom.isAfter(now) ? "draft" : "active";
  }

  private static String normalizePromotionStatusFilter(String status) {
    if (status == null || status.isBlank()) {
      return null;
    }
    String normalized = status.trim().toLowerCase(Locale.ROOT).replace('-', '_');
    return switch (normalized) {
      case "all" -> null;
      case "active" -> "active";
      case "inactive", "paused" -> "inactive";
      case "draft", "scheduled" -> "draft";
      case "expired" -> "expired";
      case "cancelled" -> "cancelled";
      default -> throw ServiceException.badRequest("Unsupported promotion status filter: " + status);
    };
  }

  private static BigDecimal money(BigDecimal value) {
    return value == null ? BigDecimal.ZERO : value;
  }

  private static String trimToNull(String value) {
    if (value == null) {
      return null;
    }
    String trimmed = value.trim();
    return trimmed.isEmpty() ? null : trimmed;
  }

  private Optional<SalesDtos.OrderingTableDetailView> findOrderingTableById(Connection conn, long tableId)
      throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT
          t.id,
          t.public_token,
          t.table_code,
          t.display_name,
          t.status,
          t.outlet_id,
          o.code AS outlet_code,
          o.name AS outlet_name,
          t.created_at,
          t.updated_at
        FROM core.ordering_table t
        JOIN core.outlet o ON o.id = t.outlet_id
        WHERE t.id = ? AND t.deleted_at IS NULL
        """
    )) {
      ps.setLong(1, tableId);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) {
          return Optional.empty();
        }
        return Optional.of(mapOrderingTableDetail(rs));
      }
    }
  }

  private Optional<OrderingTableRecord> lockOrderingTableByToken(Connection conn, String tableToken) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT id, outlet_id, status
        FROM core.ordering_table
        WHERE public_token = ? AND deleted_at IS NULL
        FOR UPDATE
        """
    )) {
      ps.setString(1, tableToken);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) {
          return Optional.empty();
        }
        return Optional.of(new OrderingTableRecord(
            rs.getLong("id"),
            rs.getLong("outlet_id"),
            rs.getString("status")
        ));
      }
    }
  }

  private SalesDtos.OrderingTableLinkView mapOrderingTableLink(ResultSet rs) {
    try {
      return new SalesDtos.OrderingTableLinkView(
          rs.getString("public_token"),
          rs.getString("table_code"),
          rs.getString("display_name"),
          rs.getString("status"),
          rs.getLong("outlet_id"),
          rs.getString("outlet_code"),
          rs.getString("outlet_name")
      );
    } catch (Exception e) {
      throw new IllegalStateException("Unable to map ordering table link", e);
    }
  }

  private SalesDtos.OrderingTableDetailView mapOrderingTableDetail(ResultSet rs) {
    try {
      return new SalesDtos.OrderingTableDetailView(
          rs.getLong("id"),
          rs.getString("public_token"),
          rs.getString("table_code"),
          rs.getString("display_name"),
          rs.getString("status"),
          rs.getLong("outlet_id"),
          rs.getString("outlet_code"),
          rs.getString("outlet_name"),
          rs.getTimestamp("created_at").toInstant(),
          rs.getTimestamp("updated_at").toInstant()
      );
    } catch (Exception e) {
      throw new IllegalStateException("Unable to map ordering table detail", e);
    }
  }

  private static String normalizeOrderingTableStatus(String value, String fallback) {
    String normalized = trimToNull(value);
    if (normalized == null) {
      return fallback;
    }
    String key = normalized.toLowerCase(Locale.ROOT).replace('-', '_');
    return switch (key) {
      case "active" -> "active";
      case "inactive", "unavailable", "disabled" -> "unavailable";
      case "archived" -> "archived";
      default -> throw ServiceException.badRequest("Unsupported ordering table status: " + value);
    };
  }

  private CrmDtos.CustomerView mapCustomerReference(ResultSet rs) {
    try {
      return new CrmDtos.CustomerView(
          rs.getString("customer_ref"),
          rs.getString("reference_type"),
          rs.getString("display_name"),
          rs.getLong("outlet_id"),
          rs.getString("outlet_code"),
          rs.getString("outlet_name"),
          rs.getLong("order_count"),
          rs.getBigDecimal("total_spend"),
          rs.getTimestamp("last_order_at").toInstant()
      );
    } catch (Exception e) {
      throw new IllegalStateException("Unable to map CRM customer reference row", e);
    }
  }

  private static long getLong(ResultSet rs, String column) {
    try {
      return rs.getLong(column);
    } catch (Exception e) {
      throw new IllegalStateException("Unable to read column " + column, e);
    }
  }

  private static long parsePublicProductId(String productId) {
    try {
      return Long.parseLong(productId.trim());
    } catch (Exception e) {
      throw ServiceException.badRequest("Invalid productId: " + productId);
    }
  }

  private static String buildPublicOrderNote(String tableCode, String tableName, String note) {
    String prefix = "QR order " + tableCode + " (" + tableName + ")";
    String trimmedNote = trimToNull(note);
    return trimmedNote == null ? prefix : prefix + " · " + trimmedNote;
  }

  private void appendOutletScope(
      StringBuilder sql,
      List<Object> params,
      String column,
      Set<Long> outletIds
  ) {
    if (outletIds == null) {
      return;
    }
    sql.append(" AND ").append(column).append(" IN (");
    boolean first = true;
    for (Long outletId : outletIds) {
      if (!first) {
        sql.append(", ");
      }
      sql.append("?");
      params.add(outletId);
      first = false;
    }
    sql.append(")");
  }

  private void appendPromotionScope(
      StringBuilder sql,
      List<Object> params,
      Set<Long> outletIds
  ) {
    if (outletIds == null) {
      return;
    }
    if (outletIds.isEmpty()) {
      sql.append(" AND 1 = 0");
      return;
    }
    sql.append(" AND EXISTS (SELECT 1 FROM core.promotion_scope ps WHERE ps.promotion_id = p.id AND ps.outlet_id IN (");
    boolean first = true;
    for (Long outletId : outletIds) {
      if (!first) {
        sql.append(", ");
      }
      sql.append("?");
      params.add(outletId);
      first = false;
    }
    sql.append("))");
  }

  private void bindParams(PreparedStatement ps, List<Object> params) throws Exception {
    for (int i = 0; i < params.size(); i++) {
      Object value = params.get(i);
      if (value instanceof Long longValue) {
        ps.setLong(i + 1, longValue);
      } else if (value instanceof Integer integerValue) {
        ps.setInt(i + 1, integerValue);
      } else if (value instanceof String stringValue) {
        ps.setString(i + 1, stringValue);
      } else if (value instanceof Timestamp timestamp) {
        ps.setTimestamp(i + 1, timestamp);
      } else if (value instanceof LocalDate localDate) {
        ps.setObject(i + 1, localDate);
      } else {
        ps.setObject(i + 1, value);
      }
    }
  }

  private record AggregatedSaleLine(
      long productId,
      BigDecimal quantity,
      BigDecimal unitPrice,
      BigDecimal discountAmount,
      BigDecimal taxAmount,
      Set<Long> promotionIds,
      String note
  ) {
  }

  private record InventoryPlan(
      List<SaleUsageMovement> movements,
      List<java.util.Map<String, Object>> shortages
  ) {
  }

  private record SaleUsageMovement(
      long productId,
      long itemId,
      BigDecimal qtyChange
  ) {
  }

  private record RecipeComponentRecord(
      long productId,
      long itemId,
      String itemCode,
      String itemName,
      BigDecimal componentQty,
      BigDecimal yieldQty,
      String componentUomCode,
      String itemBaseUomCode,
      BigDecimal conversionFactor
  ) {
  }

  private record LockedSaleRecord(
      long saleId,
      long outletId,
      Long posSessionId,
      String status,
      BigDecimal totalAmount,
      LocalDate businessDate,
      String note
  ) {
  }

  private record LockedPosSessionRecord(
      long sessionId,
      long outletId,
      String sessionCode,
      LocalDate businessDate,
      Instant openedAt,
      Instant closedAt,
      String status,
      String note
  ) {
  }

  private static final class RequirementAccumulator {

    private final long itemId;
    private final String itemCode;
    private final String itemName;
    private BigDecimal requiredQuantity = BigDecimal.ZERO.setScale(4, RoundingMode.HALF_UP);
    private final Set<Long> productIds = new LinkedHashSet<>();

    private RequirementAccumulator(long itemId, String itemCode, String itemName) {
      this.itemId = itemId;
      this.itemCode = itemCode;
      this.itemName = itemName;
    }

    private void accumulate(BigDecimal quantity, long productId) {
      requiredQuantity = requiredQuantity.add(quantity).setScale(4, RoundingMode.HALF_UP);
      productIds.add(productId);
    }

    private long itemId() {
      return itemId;
    }

    private String itemCode() {
      return itemCode;
    }

    private String itemName() {
      return itemName;
    }

    private BigDecimal requiredQuantity() {
      return requiredQuantity;
    }

    private Set<Long> productIds() {
      return Set.copyOf(productIds);
    }
  }

  private record OrderingTableRecord(
      long id,
      long outletId,
      String status
  ) {
  }

  public record PublicOrderingTableRecord(
      long id,
      long outletId,
      String tableCode,
      String displayName,
      String publicToken,
      String status,
      String outletCode,
      String outletName,
      String outletStatus,
      String currencyCode,
      String timezoneName
  ) {
  }

  public record CreatedPublicOrder(
      String orderToken,
      SalesDtos.SaleView sale
  ) {
  }

  private record PublicMenuItemRecord(
      long productId,
      String code,
      String name,
      String categoryCode,
      String description,
      String imageUrl,
      BigDecimal priceValue,
      String currencyCode
  ) {
  }

  private record PublicOrderMetadata(
      long orderingTableId,
      String orderToken
  ) {
  }

  public List<SalesDtos.MonthlyRevenueRow> monthlyRevenue(
      Set<Long> outletIds,
      LocalDate startDate,
      LocalDate endDate
  ) {
    if (outletIds != null && outletIds.isEmpty()) {
      return List.of();
    }
    return executeInTransaction(conn -> {
      StringBuilder sql = new StringBuilder(
          """
          SELECT
            ps.outlet_id,
            to_char(date_trunc('month', ps.business_date), 'YYYY-MM') AS month,
            COUNT(*) FILTER (WHERE sr.status = 'completed') AS order_count,
            COUNT(*) FILTER (WHERE sr.status = 'cancelled') AS cancelled_count,
            COALESCE(SUM(sr.subtotal)  FILTER (WHERE sr.status = 'completed'), 0) AS gross_sales,
            COALESCE(SUM(sr.discount)  FILTER (WHERE sr.status = 'completed'), 0) AS discounts,
            COALESCE(SUM(sr.tax_amount) FILTER (WHERE sr.status = 'completed'), 0) AS tax_amount,
            COALESCE(SUM(sr.total_amount) FILTER (WHERE sr.status = 'completed'), 0) AS total_amount,
            COALESCE(SUM(sr.subtotal)  FILTER (WHERE sr.status = 'cancelled'), 0) AS voids,
            MIN(sr.currency_code) AS currency_code
          FROM core.pos_session ps
          JOIN core.sale_record sr ON sr.pos_session_id = ps.id
          WHERE 1 = 1
          """
      );
      List<Object> params = new ArrayList<>();
      appendOutletScope(sql, params, "ps.outlet_id", outletIds);
      if (startDate != null) {
        sql.append(" AND ps.business_date >= ?");
        params.add(java.sql.Date.valueOf(startDate));
      }
      if (endDate != null) {
        sql.append(" AND ps.business_date <= ?");
        params.add(java.sql.Date.valueOf(endDate));
      }
      sql.append(" GROUP BY ps.outlet_id, date_trunc('month', ps.business_date)");
      sql.append(" ORDER BY ps.outlet_id, month");

      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        for (int i = 0; i < params.size(); i++) {
          ps.setObject(i + 1, params.get(i));
        }
        try (ResultSet rs = ps.executeQuery()) {
          List<SalesDtos.MonthlyRevenueRow> rows = new ArrayList<>();
          while (rs.next()) {
            BigDecimal gross = rs.getBigDecimal("gross_sales");
            BigDecimal discount = rs.getBigDecimal("discounts");
            BigDecimal net = (gross == null ? BigDecimal.ZERO : gross)
                .subtract(discount == null ? BigDecimal.ZERO : discount);
            rows.add(new SalesDtos.MonthlyRevenueRow(
                rs.getLong("outlet_id"),
                rs.getString("month"),
                rs.getLong("order_count"),
                rs.getLong("cancelled_count"),
                gross == null ? BigDecimal.ZERO : gross,
                discount == null ? BigDecimal.ZERO : discount,
                net,
                nullSafe(rs.getBigDecimal("tax_amount")),
                nullSafe(rs.getBigDecimal("total_amount")),
                nullSafe(rs.getBigDecimal("voids")),
                rs.getString("currency_code")
            ));
          }
          return rows;
        }
      }
    });
  }

  public List<SalesDtos.DailyRevenueRow> dailyRevenue(
      Set<Long> outletIds,
      LocalDate startDate,
      LocalDate endDate
  ) {
    if (outletIds != null && outletIds.isEmpty()) {
      return List.of();
    }
    return executeInTransaction(conn -> {
      record Key(long outletId, LocalDate date) {}

      java.util.Map<Key, SalesDtos.DailyRevenueRow> acc = new java.util.LinkedHashMap<>();
      java.util.Map<Key, java.util.Map<String, BigDecimal>> paymentAmount = new java.util.HashMap<>();
      java.util.Map<Key, java.util.Map<String, Long>> paymentCount = new java.util.HashMap<>();
      java.util.Map<Key, java.util.Map<String, BigDecimal>> channelAmount = new java.util.HashMap<>();
      java.util.Map<Key, java.util.Map<String, Long>> channelCount = new java.util.HashMap<>();
      java.util.Map<Key, Long> paymentCoded = new java.util.HashMap<>();

      StringBuilder aggSql = new StringBuilder(
          """
          SELECT
            ps.outlet_id,
            ps.business_date,
            COUNT(*) FILTER (WHERE sr.status = 'completed') AS order_count,
            COUNT(*) FILTER (WHERE sr.status = 'cancelled') AS cancelled_count,
            COALESCE(SUM(sr.subtotal)  FILTER (WHERE sr.status = 'completed'), 0) AS gross_sales,
            COALESCE(SUM(sr.discount)  FILTER (WHERE sr.status = 'completed'), 0) AS discounts,
            COALESCE(SUM(sr.tax_amount) FILTER (WHERE sr.status = 'completed'), 0) AS tax_amount,
            COALESCE(SUM(sr.total_amount) FILTER (WHERE sr.status = 'completed'), 0) AS total_amount,
            COALESCE(SUM(sr.subtotal)  FILTER (WHERE sr.status = 'cancelled'), 0) AS voids,
            MIN(sr.currency_code) AS currency_code
          FROM core.pos_session ps
          JOIN core.sale_record sr ON sr.pos_session_id = ps.id
          WHERE 1 = 1
          """
      );
      List<Object> aggParams = new ArrayList<>();
      appendOutletScope(aggSql, aggParams, "ps.outlet_id", outletIds);
      if (startDate != null) {
        aggSql.append(" AND ps.business_date >= ?");
        aggParams.add(java.sql.Date.valueOf(startDate));
      }
      if (endDate != null) {
        aggSql.append(" AND ps.business_date <= ?");
        aggParams.add(java.sql.Date.valueOf(endDate));
      }
      aggSql.append(" GROUP BY ps.outlet_id, ps.business_date ORDER BY ps.outlet_id, ps.business_date");

      try (PreparedStatement ps = conn.prepareStatement(aggSql.toString())) {
        for (int i = 0; i < aggParams.size(); i++) {
          ps.setObject(i + 1, aggParams.get(i));
        }
        try (ResultSet rs = ps.executeQuery()) {
          while (rs.next()) {
            long outletId = rs.getLong("outlet_id");
            LocalDate bd = rs.getObject("business_date", LocalDate.class);
            BigDecimal gross = nullSafe(rs.getBigDecimal("gross_sales"));
            BigDecimal discount = nullSafe(rs.getBigDecimal("discounts"));
            BigDecimal net = gross.subtract(discount);
            Key key = new Key(outletId, bd);
            acc.put(key, new SalesDtos.DailyRevenueRow(
                outletId,
                bd,
                rs.getLong("order_count"),
                rs.getLong("cancelled_count"),
                gross,
                discount,
                net,
                nullSafe(rs.getBigDecimal("tax_amount")),
                nullSafe(rs.getBigDecimal("total_amount")),
                nullSafe(rs.getBigDecimal("voids")),
                rs.getString("currency_code"),
                List.of(),
                List.of(),
                0L
            ));
          }
        }
      }

      StringBuilder paySql = new StringBuilder(
          """
          SELECT ps.outlet_id, ps.business_date, p.payment_method,
                 SUM(sr.total_amount) AS amount, COUNT(*) AS cnt
          FROM core.pos_session ps
          JOIN core.sale_record sr ON sr.pos_session_id = ps.id
          LEFT JOIN core.payment p ON p.sale_id = sr.id
          WHERE sr.status = 'completed'
          """
      );
      List<Object> payParams = new ArrayList<>();
      appendOutletScope(paySql, payParams, "ps.outlet_id", outletIds);
      if (startDate != null) {
        paySql.append(" AND ps.business_date >= ?");
        payParams.add(java.sql.Date.valueOf(startDate));
      }
      if (endDate != null) {
        paySql.append(" AND ps.business_date <= ?");
        payParams.add(java.sql.Date.valueOf(endDate));
      }
      paySql.append(" GROUP BY ps.outlet_id, ps.business_date, p.payment_method");

      try (PreparedStatement ps = conn.prepareStatement(paySql.toString())) {
        for (int i = 0; i < payParams.size(); i++) {
          ps.setObject(i + 1, payParams.get(i));
        }
        try (ResultSet rs = ps.executeQuery()) {
          while (rs.next()) {
            long outletId = rs.getLong("outlet_id");
            LocalDate bd = rs.getObject("business_date", LocalDate.class);
            Key key = new Key(outletId, bd);
            String method = rs.getString("payment_method");
            BigDecimal amount = nullSafe(rs.getBigDecimal("amount"));
            long cnt = rs.getLong("cnt");
            if (method != null && !method.isBlank()) {
              paymentAmount.computeIfAbsent(key, k -> new java.util.LinkedHashMap<>())
                  .merge(method, amount, BigDecimal::add);
              paymentCount.computeIfAbsent(key, k -> new java.util.HashMap<>())
                  .merge(method, cnt, Long::sum);
              paymentCoded.merge(key, cnt, Long::sum);
            }
          }
        }
      }

      StringBuilder chSql = new StringBuilder(
          """
          SELECT ps.outlet_id, ps.business_date, sr.order_type,
                 SUM(sr.total_amount) AS amount, COUNT(*) AS cnt
          FROM core.pos_session ps
          JOIN core.sale_record sr ON sr.pos_session_id = ps.id
          WHERE sr.status = 'completed'
          """
      );
      List<Object> chParams = new ArrayList<>();
      appendOutletScope(chSql, chParams, "ps.outlet_id", outletIds);
      if (startDate != null) {
        chSql.append(" AND ps.business_date >= ?");
        chParams.add(java.sql.Date.valueOf(startDate));
      }
      if (endDate != null) {
        chSql.append(" AND ps.business_date <= ?");
        chParams.add(java.sql.Date.valueOf(endDate));
      }
      chSql.append(" GROUP BY ps.outlet_id, ps.business_date, sr.order_type");

      try (PreparedStatement ps = conn.prepareStatement(chSql.toString())) {
        for (int i = 0; i < chParams.size(); i++) {
          ps.setObject(i + 1, chParams.get(i));
        }
        try (ResultSet rs = ps.executeQuery()) {
          while (rs.next()) {
            long outletId = rs.getLong("outlet_id");
            LocalDate bd = rs.getObject("business_date", LocalDate.class);
            Key key = new Key(outletId, bd);
            String channel = rs.getString("order_type");
            BigDecimal amount = nullSafe(rs.getBigDecimal("amount"));
            long cnt = rs.getLong("cnt");
            String chKey = channel == null ? "unknown" : channel;
            channelAmount.computeIfAbsent(key, k -> new java.util.LinkedHashMap<>())
                .merge(chKey, amount, BigDecimal::add);
            channelCount.computeIfAbsent(key, k -> new java.util.HashMap<>())
                .merge(chKey, cnt, Long::sum);
          }
        }
      }

      List<SalesDtos.DailyRevenueRow> out = new ArrayList<>();
      for (var entry : acc.entrySet()) {
        Key key = entry.getKey();
        SalesDtos.DailyRevenueRow row = entry.getValue();
        List<SalesDtos.RevenueMixEntry> payMix = new ArrayList<>();
        java.util.Map<String, BigDecimal> payAmt = paymentAmount.getOrDefault(key, java.util.Map.of());
        java.util.Map<String, Long> payCnt = paymentCount.getOrDefault(key, java.util.Map.of());
        for (var e : payAmt.entrySet()) {
          payMix.add(new SalesDtos.RevenueMixEntry(e.getKey(), e.getValue(), payCnt.getOrDefault(e.getKey(), 0L)));
        }
        List<SalesDtos.RevenueMixEntry> chMix = new ArrayList<>();
        java.util.Map<String, BigDecimal> chAmt = channelAmount.getOrDefault(key, java.util.Map.of());
        java.util.Map<String, Long> chCnt = channelCount.getOrDefault(key, java.util.Map.of());
        for (var e : chAmt.entrySet()) {
          chMix.add(new SalesDtos.RevenueMixEntry(e.getKey(), e.getValue(), chCnt.getOrDefault(e.getKey(), 0L)));
        }
        out.add(new SalesDtos.DailyRevenueRow(
            row.outletId(),
            row.businessDate(),
            row.orderCount(),
            row.cancelledCount(),
            row.grossSales(),
            row.discounts(),
            row.netSales(),
            row.taxAmount(),
            row.totalAmount(),
            row.voids(),
            row.currencyCode(),
            payMix,
            chMix,
            paymentCoded.getOrDefault(key, 0L)
        ));
      }
      return out;
    });
  }

  private static BigDecimal nullSafe(BigDecimal value) {
    return value == null ? BigDecimal.ZERO : value;
  }
}
