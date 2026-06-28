package com.fern.services.sales.infrastructure;

import com.fern.common.middleware.ServiceException;
import com.fern.common.outbox.OutboxWriter;
import com.fern.common.repository.BaseRepository;
import com.fern.common.spring.auth.RequestUserContext;
import com.fern.common.spring.auth.RequestUserContextHolder;
import com.fern.events.sales.PaymentCapturedEvent;
import com.fern.events.sales.SaleApprovedEvent;
import com.fern.events.sales.SaleCancelledEvent;
import com.fern.events.sales.SaleCompletedEvent;
import com.fern.events.sales.SaleCompletedLineItem;
import com.fern.common.spring.web.PagedResult;
import com.fern.common.spring.web.QueryConventions;
import com.fern.services.sales.api.CrmDtos;
import com.fern.services.sales.api.PublicPosDtos;
import com.fern.services.sales.api.SalesDtos;
import com.fern.common.utils.services.id.SnowflakeIdGenerator;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.sql.Types;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import javax.sql.DataSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Repository;

@Repository
public class SalesRepository extends BaseRepository {

  private static final Set<String> CRM_CUSTOMER_SORT_KEYS =
      Set.of("lastOrderAt", "totalSpend", "orderCount", "displayName", "customerRef");
  private static final Set<String> SALE_LIST_SORT_KEYS =
      Set.of("createdAt", "totalAmount", "status", "paymentStatus", "id");
  private static final String DEFAULT_OUTLET_TIMEZONE = "Asia/Ho_Chi_Minh";

  private final SnowflakeIdGenerator snowflakeIdGenerator;
  private final Clock clock;
  private final OutboxWriter outboxWriter;
  private final SalesPaymentRepository paymentRepository;
  private final SalesSessionRepository sessionRepository;
  private InventoryAvailabilityClient availabilityClient;
  private boolean readModeService;

  @org.springframework.beans.factory.annotation.Autowired(required = false)
  public void setInventoryAvailabilityClient(InventoryAvailabilityClient client) {
    this.availabilityClient = client;
  }

  @org.springframework.beans.factory.annotation.Value("${sales.inventory.read-mode:direct}")
  public void setReadMode(String mode) {
    this.readModeService = "service".equalsIgnoreCase(mode);
  }

  @Autowired
  public SalesRepository(
      DataSource dataSource,
      SnowflakeIdGenerator snowflakeIdGenerator,
      Clock clock,
      OutboxWriter outboxWriter,
      SalesPaymentRepository paymentRepository,
      SalesSessionRepository sessionRepository
  ) {
    super(dataSource);
    this.snowflakeIdGenerator = snowflakeIdGenerator;
    this.clock = clock;
    this.outboxWriter = outboxWriter;
    this.paymentRepository = paymentRepository;
    this.sessionRepository = sessionRepository == null
        ? new SalesSessionRepository(dataSource, snowflakeIdGenerator, clock, paymentRepository)
        : sessionRepository;
  }

  public SalesRepository(
      DataSource dataSource,
      SnowflakeIdGenerator snowflakeIdGenerator,
      Clock clock,
      OutboxWriter outboxWriter
  ) {
    this(dataSource, snowflakeIdGenerator, clock, outboxWriter,
        new SalesPaymentRepository(dataSource, clock),
        null);
  }

  // Backward-compatible constructor for tests without outbox
  public SalesRepository(
      DataSource dataSource,
      SnowflakeIdGenerator snowflakeIdGenerator,
      Clock clock
  ) {
    this(dataSource, snowflakeIdGenerator, clock, null);
  }

  public SalesDtos.PosSessionView openPosSession(SalesDtos.OpenPosSessionRequest request) {
    return sessionRepository.openPosSession(request);
  }

  /** Sync-path overload: caller can pin the session id supplied by the device client. */
  public SalesDtos.PosSessionView openPosSession(SalesDtos.OpenPosSessionRequest request, Long overrideSessionId) {
    return sessionRepository.openPosSession(request, overrideSessionId);
  }

  public SalesDtos.PosSessionView closePosSession(long sessionId, String note) {
    return sessionRepository.closePosSession(sessionId, note);
  }

  public SalesDtos.PosSessionReconciliationView reconcilePosSession(
      long sessionId,
      SalesDtos.ReconcilePosSessionRequest request,
      Long actorUserId
  ) {
    return sessionRepository.reconcilePosSession(sessionId, request, actorUserId);
  }

  public SalesDtos.SaleView submitSale(SalesDtos.SubmitSaleRequest request) {
    return submitSale(request, null);
  }

  /** Sync-path overload: caller pins the sale id so edge + central match. */
  public SalesDtos.SaleView submitSale(SalesDtos.SubmitSaleRequest request, Long overrideSaleId) {
    return executeInTransaction(conn -> {
      if (overrideSaleId != null) {
        lockSyncEntity(conn, overrideSaleId);
        Optional<SalesDtos.SaleView> existing = findSale(conn, overrideSaleId);
        if (existing.isPresent()) {
          return existing.get();
        }
      }
      return submitSale(
          conn,
          request,
          currentBusinessDate(conn, request.outletId()),
          null,
          overrideSaleId);
    });
  }

  public CreatedPublicOrder submitPublicOrderBatch(
      PublicOrderingTableRecord table,
      PublicPosDtos.CreatePublicOrderRequest request,
      LocalDate businessDate,
      Map<Long, BigDecimal> discountByProductId,
      Long promotionId
  ) {
    return executeInTransaction(conn -> {
      validatePublicOrderItems(conn, table.outletId(), businessDate, request.items());
      Set<Long> productIds = request.items().stream()
          .map(item -> parsePublicProductId(item.productId()))
          .collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new));
      Map<Long, PublicMenuItemRecord> menu = listPublicMenuRecords(conn, table.outletId(), businessDate, productIds);
      long batchId = snowflakeIdGenerator.generateId();
      String orderToken = "ord_" + UUID.randomUUID().toString().replace("-", "");
      Instant now = clock.instant();
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.public_order_batch (
            id, outlet_id, ordering_table_id, order_token, status, note, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
          """
      )) {
        ps.setLong(1, batchId);
        ps.setLong(2, table.outletId());
        ps.setLong(3, table.id());
        ps.setString(4, orderToken);
        ps.setString(5, trimToNull(request.note()));
        ps.setTimestamp(6, Timestamp.from(now));
        ps.setTimestamp(7, Timestamp.from(now));
        ps.executeUpdate();
      }
      for (PublicPosDtos.PublicOrderLineRequest item : request.items()) {
        long productId = parsePublicProductId(item.productId());
        PublicMenuItemRecord menuItem = menu.get(productId);
        if (menuItem == null) {
          throw ServiceException.conflict("Product is not available for public ordering: " + productId);
        }
        BigDecimal quantity = item.quantity();
        BigDecimal discount = discountByProductId.getOrDefault(productId, BigDecimal.ZERO);
        BigDecimal tax = BigDecimal.ZERO;
        BigDecimal lineTotal = menuItem.priceValue().multiply(quantity).subtract(discount).add(tax)
            .setScale(2, RoundingMode.HALF_UP);
        try (PreparedStatement ps = conn.prepareStatement(
            """
            INSERT INTO core.public_order_batch_item (
              batch_id, product_id, qty, note, unit_price, discount_amount, tax_amount, line_total, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
            """
        )) {
          ps.setLong(1, batchId);
          ps.setLong(2, productId);
          ps.setBigDecimal(3, quantity);
          ps.setString(4, trimToNull(item.note()));
          ps.setBigDecimal(5, menuItem.priceValue());
          ps.setBigDecimal(6, discount.setScale(2, RoundingMode.HALF_UP));
          ps.setBigDecimal(7, tax.setScale(2, RoundingMode.HALF_UP));
          ps.setBigDecimal(8, lineTotal);
          ps.setTimestamp(9, Timestamp.from(now));
          ps.setTimestamp(10, Timestamp.from(now));
          ps.executeUpdate();
        }
      }
      return findPublicOrderBatch(conn, orderToken)
          .orElseThrow(() -> new IllegalStateException("Created public order batch not found"));
    });
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
    return submitPublicOrder(table, request, businessDate, java.util.Map.of());
  }

  public CreatedPublicOrder submitPublicOrder(
      PublicOrderingTableRecord table,
      PublicPosDtos.CreatePublicOrderRequest request,
      LocalDate businessDate,
      java.util.Map<Long, BigDecimal> discountByProductId
  ) {
    return submitPublicOrder(table, request, businessDate, discountByProductId, null);
  }

  public CreatedPublicOrder submitPublicOrder(
      PublicOrderingTableRecord table,
      PublicPosDtos.CreatePublicOrderRequest request,
      LocalDate businessDate,
      java.util.Map<Long, BigDecimal> discountByProductId,
      Long promotionId
  ) {
    return executeInTransaction(conn -> {
      validatePublicOrderItems(conn, table.outletId(), businessDate, request.items());
      List<SalesDtos.SaleLineRequest> lines = request.items().stream()
          .map(item -> {
            long productId = parsePublicProductId(item.productId());
            BigDecimal discount = discountByProductId.getOrDefault(productId, BigDecimal.ZERO);
            Set<Long> promotionIds = promotionId != null && discount.signum() > 0
                ? Set.of(promotionId)
                : Set.of();
            return new SalesDtos.SaleLineRequest(
                productId,
                item.quantity(),
                discount,
                BigDecimal.ZERO,
                trimToNull(item.note()),
                promotionIds,
                null,
                null,
                null
            );
          })
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
      Optional<CreatedPublicOrder> batch = findPublicOrderBatch(conn, orderToken);
      if (batch.isPresent()) {
        return batch;
      }
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

  public List<SalesDtos.PublicOrderBatchView> listPublicOrderBatches(Set<Long> outletIds) {
    if (outletIds != null && outletIds.isEmpty()) {
      return List.of();
    }
    return executeInTransaction(conn -> {
      StringBuilder sql = new StringBuilder(
          """
          SELECT
            b.id,
            b.outlet_id,
            b.sale_id,
            b.order_token,
            b.status,
            b.note,
            b.created_at,
            t.table_code,
            t.display_name,
            r.currency_code,
            COALESCE(SUM(bi.line_total), 0) AS total_amount
          FROM core.public_order_batch b
          JOIN core.ordering_table t ON t.id = b.ordering_table_id
          JOIN core.outlet o ON o.id = b.outlet_id
          JOIN core.region r ON r.id = o.region_id
          LEFT JOIN core.public_order_batch_item bi ON bi.batch_id = b.id
          WHERE 1 = 1
          """
      );
      List<Object> params = new ArrayList<>();
      appendOutletScope(sql, params, "b.outlet_id", outletIds);
      sql.append("""
          GROUP BY b.id, b.outlet_id, b.sale_id, b.order_token, b.status, b.note, b.created_at,
                   t.table_code, t.display_name, r.currency_code
          ORDER BY b.created_at DESC
          LIMIT 200
          """);
      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bindParams(ps, params);
        try (ResultSet rs = ps.executeQuery()) {
          List<SalesDtos.PublicOrderBatchView> rows = new ArrayList<>();
          while (rs.next()) {
            long batchId = rs.getLong("id");
            Object saleId = rs.getObject("sale_id");
            rows.add(new SalesDtos.PublicOrderBatchView(
                Long.toString(batchId),
                rs.getLong("outlet_id"),
                saleId == null ? null : Long.toString(((Number) saleId).longValue()),
                rs.getString("order_token"),
                rs.getString("table_code"),
                rs.getString("display_name"),
                rs.getString("currency_code"),
                rs.getString("status"),
                "approved".equalsIgnoreCase(rs.getString("status")) ? "unpaid" : "pending",
                rs.getBigDecimal("total_amount"),
                rs.getString("note"),
                rs.getTimestamp("created_at").toInstant(),
                loadPublicOrderBatchItemViews(conn, batchId)
            ));
          }
          return List.copyOf(rows);
        }
      }
    });
  }

  private List<SalesDtos.PublicOrderBatchItemView> loadPublicOrderBatchItemViews(Connection conn, long batchId)
      throws Exception {
    List<SalesDtos.PublicOrderBatchItemView> items = new ArrayList<>();
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT
          bi.product_id,
          p.code AS product_code,
          p.name AS product_name,
          bi.qty,
          bi.unit_price,
          bi.line_total,
          bi.note,
          bi.status
        FROM core.public_order_batch_item bi
        LEFT JOIN core.product p ON p.id = bi.product_id
        WHERE bi.batch_id = ?
        ORDER BY bi.id
        """
    )) {
      ps.setLong(1, batchId);
      try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
          items.add(new SalesDtos.PublicOrderBatchItemView(
              Long.toString(rs.getLong("product_id")),
              rs.getString("product_code"),
              rs.getString("product_name"),
              rs.getBigDecimal("qty"),
              rs.getBigDecimal("unit_price"),
              rs.getBigDecimal("line_total"),
              rs.getString("note"),
              rs.getString("status")
          ));
        }
      }
    }
    return List.copyOf(items);
  }

  private Optional<CreatedPublicOrder> findPublicOrderBatch(Connection conn, String orderToken) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT
          b.id,
          b.order_token,
          b.sale_id,
          b.status,
          b.note,
          b.created_at,
          t.table_code,
          t.display_name,
          o.code AS outlet_code,
          o.name AS outlet_name,
          r.currency_code
        FROM core.public_order_batch b
        JOIN core.ordering_table t ON t.id = b.ordering_table_id
        JOIN core.outlet o ON o.id = b.outlet_id
        JOIN core.region r ON r.id = o.region_id
        WHERE b.order_token = ?
        """
    )) {
      ps.setString(1, orderToken);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) return Optional.empty();
        Object saleId = rs.getObject("sale_id");
        SalesDtos.SaleView sale = saleId == null
            ? null
            : findSale(conn, ((Number) saleId).longValue()).orElse(null);
        return Optional.of(new CreatedPublicOrder(
            rs.getString("order_token"),
            sale,
            rs.getLong("id"),
            rs.getString("status"),
            rs.getString("note"),
            rs.getTimestamp("created_at").toInstant(),
            loadPublicOrderBatchItems(conn, rs.getLong("id"))
        ));
      }
    }
  }

  private Optional<PublicOrderBatchRecord> lockPublicOrderBatch(Connection conn, long batchId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT
          b.id,
          b.outlet_id,
          b.ordering_table_id,
          b.sale_id,
          b.order_token,
          b.status,
          b.note,
          b.created_at,
          t.table_code,
          t.display_name,
          r.currency_code,
          COALESCE(
            psn.business_date,
            (b.created_at AT TIME ZONE COALESCE(NULLIF(r.timezone_name, ''), ?))::date
          ) AS business_date
        FROM core.public_order_batch b
        JOIN core.ordering_table t ON t.id = b.ordering_table_id
        JOIN core.outlet o ON o.id = b.outlet_id
        JOIN core.region r ON r.id = o.region_id
        LEFT JOIN core.pos_session psn ON psn.id = b.sale_id
        WHERE b.id = ?
        FOR UPDATE OF b
        """
    )) {
      ps.setString(1, DEFAULT_OUTLET_TIMEZONE);
      ps.setLong(2, batchId);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) return Optional.empty();
        Object saleId = rs.getObject("sale_id");
        return Optional.of(new PublicOrderBatchRecord(
            rs.getLong("id"),
            rs.getLong("outlet_id"),
            rs.getLong("ordering_table_id"),
            saleId == null ? null : ((Number) saleId).longValue(),
            rs.getString("order_token"),
            rs.getString("status"),
            rs.getString("note"),
            rs.getTimestamp("created_at").toInstant(),
            rs.getString("table_code"),
            rs.getString("display_name"),
            rs.getString("currency_code"),
            rs.getObject("business_date", LocalDate.class)
        ));
      }
    }
  }

  private List<PublicOrderBatchItemRecord> loadPublicOrderBatchItemRecords(Connection conn, long batchId)
      throws Exception {
    List<PublicOrderBatchItemRecord> items = new ArrayList<>();
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT product_id, qty, note, unit_price, discount_amount, tax_amount, line_total, status
        FROM core.public_order_batch_item
        WHERE batch_id = ?
        ORDER BY id
        """
    )) {
      ps.setLong(1, batchId);
      try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
          items.add(new PublicOrderBatchItemRecord(
              rs.getLong("product_id"),
              rs.getBigDecimal("qty"),
              rs.getString("note"),
              rs.getBigDecimal("unit_price"),
              rs.getBigDecimal("discount_amount"),
              rs.getBigDecimal("tax_amount"),
              rs.getBigDecimal("line_total"),
              rs.getString("status")
          ));
        }
      }
    }
    return List.copyOf(items);
  }

  private List<PublicPosDtos.PublicOrderLineView> loadPublicOrderBatchItems(Connection conn, long batchId)
      throws Exception {
    List<PublicPosDtos.PublicOrderLineView> items = new ArrayList<>();
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT
          bi.product_id,
          p.code AS product_code,
          p.name AS product_name,
          bi.qty,
          bi.unit_price,
          bi.line_total,
          bi.note,
          bi.status
        FROM core.public_order_batch_item bi
        LEFT JOIN core.product p ON p.id = bi.product_id
        WHERE bi.batch_id = ?
        ORDER BY bi.id
        """
    )) {
      ps.setLong(1, batchId);
      try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
          String productId = Long.toString(rs.getLong("product_id"));
          items.add(new PublicPosDtos.PublicOrderLineView(
              productId,
              rs.getString("product_code"),
              rs.getString("product_name"),
              rs.getBigDecimal("qty"),
              rs.getBigDecimal("unit_price"),
              rs.getBigDecimal("line_total"),
              rs.getString("note"),
              rs.getString("status")
          ));
        }
      }
    }
    return List.copyOf(items);
  }

  private SalesDtos.SaleView submitSale(
      Connection conn,
      SalesDtos.SubmitSaleRequest request,
      LocalDate pricingDate
  ) throws Exception {
    return submitSale(conn, request, pricingDate, null, null);
  }

  private SalesDtos.SaleView submitSale(
      Connection conn,
      SalesDtos.SubmitSaleRequest request,
      LocalDate pricingDate,
      PublicOrderMetadata publicOrderMetadata
  ) throws Exception {
    return submitSale(conn, request, pricingDate, publicOrderMetadata, null);
  }

  private SalesDtos.SaleView submitSale(
      Connection conn,
      SalesDtos.SubmitSaleRequest request,
      LocalDate pricingDate,
      PublicOrderMetadata publicOrderMetadata,
      Long overrideSaleId
  ) throws Exception {
    if (request.payment() != null) {
      throw ServiceException.badRequest("Payment is captured with mark-payment-done after order approval");
    }
    SalesDtos.PosSessionView session = null;
    if (request.posSessionId() != null) {
      session = sessionRepository.findPosSession(conn, request.posSessionId())
          .orElseThrow(
              () ->
                  ServiceException.notFound(
                      "POS session not found: " + request.posSessionId()));
      if (!"open".equalsIgnoreCase(session.status())) {
        throw ServiceException.conflict("POS session is not open");
      }
    }

    long saleId = overrideSaleId != null ? overrideSaleId : snowflakeIdGenerator.generateId();
    Instant now = clock.instant();
    Map<Long, AggregatedSaleLine> aggregatedLines =
        aggregateLines(conn, request, pricingDate);
    if (overrideSaleId == null) {
      validateStockAvailability(
          conn,
          request.outletId(),
          aggregatedLines,
          false,
          "One or more items do not have enough stock to create this order");
    }

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

    insertSaleItems(conn, saleId, request.outletId(), now, aggregatedLines.values(), now);
    insertSaleItemModifiers(conn, saleId, now, aggregatedLines.values(), now);
    insertSalePromotions(conn, saleId, now, aggregatedLines.values(), now);
    return findSale(conn, saleId)
        .orElseThrow(() -> new IllegalStateException("Created sale not found"));
  }

  public Optional<SalesDtos.SaleView> findSale(long saleId) {
    // Read the header, line items, promotions, modifiers, and payment details on one connection.
    // The previous queryOne-based path opened nested connections while the outer ResultSet was
    // still active, which can exhaust the small runtime pool during checkout approval.
    return executeInTransaction(conn -> findSale(conn, saleId));
  }

  public Optional<SalesDtos.PosSessionView> findPosSession(long sessionId) {
    return sessionRepository.findPosSession(sessionId);
  }

  public SalesDtos.PosSessionPaymentSummaryView getPosSessionPaymentSummary(long sessionId) {
    return executeInTransaction(conn -> {
      List<SalesDtos.PosSessionPaymentSummaryLineView> items =
          paymentRepository.loadPaymentSummaryBySession(conn, sessionId);
      BigDecimal totalRevenue = items.stream()
          .map(SalesDtos.PosSessionPaymentSummaryLineView::total)
          .reduce(BigDecimal.ZERO, BigDecimal::add);
      int orderCount = items.stream()
          .mapToInt(SalesDtos.PosSessionPaymentSummaryLineView::count)
          .sum();
      return new SalesDtos.PosSessionPaymentSummaryView(orderCount, totalRevenue, items);
    });
  }

  public void linkCustomerToSale(long saleId, Long customerId) {
    execute(
        "UPDATE core.sale_record SET customer_id = ?, updated_at = NOW() WHERE id = ?",
        customerId, saleId
    );
  }

  public void linkOrderingTableToSale(long saleId, Long tableId) {
    execute(
        "UPDATE core.sale_record SET ordering_table_id = ?, updated_at = NOW() WHERE id = ?",
        tableId, saleId
    );
  }

  public Optional<Long> findCustomerIdForSale(long saleId) {
    return queryOne(
        "SELECT customer_id FROM core.sale_record WHERE id = ?",
        rs -> {
          try { long v = rs.getLong(1); return rs.wasNull() ? null : v; }
          catch (java.sql.SQLException e) { throw new IllegalStateException("read customer_id", e); }
        },
        saleId
    );
  }

  public java.math.BigDecimal findSaleTotal(long saleId) {
    return queryOne(
        "SELECT total_amount FROM core.sale_record WHERE id = ?",
        rs -> {
          try { return rs.getBigDecimal(1); }
          catch (java.sql.SQLException e) { throw new IllegalStateException("read total_amount", e); }
        },
        saleId
    ).orElse(java.math.BigDecimal.ZERO);
  }

  public void recordPointsEarned(long saleId, int points) {
    execute(
        "UPDATE core.sale_record SET points_earned = ?, updated_at = NOW() WHERE id = ?",
        points, saleId
    );
  }

  /**
   * Atomic claim of the loyalty-earn slot. Returns true exactly once per sale: only the caller
   * that flips points_earned from 0 to {@code points} via the conditional UPDATE proceeds. All
   * subsequent retries see points_earned already set and skip the ledger write.
   */
  public boolean tryClaimLoyaltyEarn(long saleId, int points) {
    return executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(
          "UPDATE core.sale_record SET points_earned = ?, updated_at = NOW() "
              + "WHERE id = ? AND COALESCE(points_earned, 0) = 0"
      )) {
        ps.setInt(1, points);
        ps.setLong(2, saleId);
        return ps.executeUpdate() > 0;
      }
    });
  }

  public boolean isSaleOversell(long saleId) {
    return queryOne(
        "SELECT oversell_flag FROM core.sale_record WHERE id = ?",
        rs -> {
          try { return rs.getBoolean(1); }
          catch (java.sql.SQLException e) { throw new IllegalStateException("read oversell_flag", e); }
        },
        saleId
    ).orElse(false);
  }

  public void recordManagerOverride(
      long outletId,
      Long saleId,
      String overrideType,
      Long managerUserId,
      String managerPinHash,
      String reason,
      Long deviceId,
      String payloadJson
  ) {
    executeInTransaction(conn -> {
      long id = snowflakeIdGenerator.generateId();
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.manager_override_audit
            (id, outlet_id, sale_id, override_type, manager_user_id, manager_pin_hash,
             reason, device_id, payload, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, NOW())
          """
      )) {
        ps.setLong(1, id);
        ps.setLong(2, outletId);
        if (saleId == null) ps.setNull(3, Types.BIGINT); else ps.setLong(3, saleId);
        ps.setString(4, overrideType);
        if (managerUserId == null) ps.setNull(5, Types.BIGINT); else ps.setLong(5, managerUserId);
        ps.setString(6, managerPinHash);
        ps.setString(7, reason);
        if (deviceId == null) ps.setNull(8, Types.BIGINT); else ps.setLong(8, deviceId);
        ps.setString(9, payloadJson);
        ps.executeUpdate();
      }
      return null;
    });
  }

  /**
   * Compares each sale_item.unit_price with the currently effective product_price for the outlet
   * at sync time. Where they differ, marks legacy_price=true and stores the current price.
   * Returns the number of lines flagged.
   */
  public int markPriceDrift(long saleId) {
    return executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          UPDATE core.sale_item si
          SET legacy_price = TRUE,
              current_price_at_sync = pp.price_value,
              updated_at = NOW()
          FROM (
            SELECT si2.product_id,
                   (SELECT pp2.price_value
                      FROM core.product_price pp2
                     WHERE pp2.product_id = si2.product_id
                       AND pp2.outlet_id = si2.outlet_id
                       AND pp2.effective_from <= CURRENT_DATE
                       AND (pp2.effective_to IS NULL OR pp2.effective_to >= CURRENT_DATE)
                     ORDER BY pp2.effective_from DESC, pp2.updated_at DESC
                     LIMIT 1) AS price_value
              FROM core.sale_item si2
             WHERE si2.sale_id = ?
          ) pp
          WHERE si.sale_id = ?
            AND si.product_id = pp.product_id
            AND pp.price_value IS NOT NULL
            AND si.unit_price <> pp.price_value
            AND si.legacy_price = FALSE
          """
      )) {
        ps.setLong(1, saleId);
        ps.setLong(2, saleId);
        return ps.executeUpdate();
      }
    });
  }

  public java.util.List<Map<String, Object>> reportPriceDrift(
      java.util.List<Long> outletIds, Instant from, Instant to, int limit) {
    if (outletIds == null || outletIds.isEmpty()) return java.util.List.of();
    StringBuilder placeholders = new StringBuilder();
    for (int i = 0; i < outletIds.size(); i++) {
      if (i > 0) placeholders.append(',');
      placeholders.append('?');
    }
    String sql = """
        SELECT si.sale_id, si.product_id, si.outlet_id,
               si.unit_price, si.current_price_at_sync, si.price_drift_amount,
               si.qty, si.created_at
          FROM core.sale_item si
         WHERE si.legacy_price = TRUE
           AND si.outlet_id IN (%s)
           AND si.created_at >= ?
           AND si.created_at <  ?
         ORDER BY si.created_at DESC
         LIMIT ?
        """.formatted(placeholders.toString());
    return executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(sql)) {
        int idx = 1;
        for (Long oid : outletIds) ps.setLong(idx++, oid);
        ps.setTimestamp(idx++, Timestamp.from(from));
        ps.setTimestamp(idx++, Timestamp.from(to));
        ps.setInt(idx, limit);
        try (ResultSet rs = ps.executeQuery()) {
          java.util.List<Map<String, Object>> out = new ArrayList<>();
          while (rs.next()) {
            Map<String, Object> row = new java.util.LinkedHashMap<>();
            row.put("saleId", rs.getLong("sale_id"));
            row.put("productId", rs.getLong("product_id"));
            row.put("outletId", rs.getLong("outlet_id"));
            row.put("unitPrice", rs.getBigDecimal("unit_price"));
            row.put("currentPriceAtSync", rs.getBigDecimal("current_price_at_sync"));
            row.put("priceDriftAmount", rs.getBigDecimal("price_drift_amount"));
            row.put("qty", rs.getBigDecimal("qty"));
            row.put("createdAt", rs.getTimestamp("created_at").toInstant().toString());
            out.add(row);
          }
          return out;
        }
      }
    });
  }

  public java.util.List<Map<String, Object>> listDltPending(int limit) {
    String sql = """
        SELECT id, aggregate_type, aggregate_id, topic, status, dlq_status,
               attempt_count, last_error, created_at
          FROM core.outbox_event
         WHERE status = 'FAILED' AND dlq_status = 'PENDING'
         ORDER BY created_at DESC
         LIMIT ?
        """;
    return executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(sql)) {
        ps.setInt(1, limit);
        try (ResultSet rs = ps.executeQuery()) {
          java.util.List<Map<String, Object>> out = new ArrayList<>();
          while (rs.next()) {
            Map<String, Object> row = new java.util.LinkedHashMap<>();
            row.put("id", rs.getLong("id"));
            row.put("aggregateType", rs.getString("aggregate_type"));
            row.put("aggregateId", rs.getLong("aggregate_id"));
            row.put("topic", rs.getString("topic"));
            row.put("status", rs.getString("status"));
            row.put("dlqStatus", rs.getString("dlq_status"));
            row.put("attempts", rs.getInt("attempt_count"));
            row.put("lastError", rs.getString("last_error"));
            row.put("createdAt", rs.getTimestamp("created_at").toInstant().toString());
            out.add(row);
          }
          return out;
        }
      }
    });
  }

  public int requeueDlt(long eventId) {
    String sql = """
        UPDATE core.outbox_event
           SET status = 'PENDING', dlq_status = 'NOT_QUEUED',
               attempt_count = 0, last_error = NULL, retry_after = NOW()
         WHERE id = ? AND status = 'FAILED'
        """;
    return executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(sql)) {
        ps.setLong(1, eventId);
        return ps.executeUpdate();
      }
    });
  }

  public Optional<SalesDtos.PosSessionView> findOpenPosSessionForOutlet(long outletId, java.time.LocalDate businessDate) {
    return sessionRepository.findOpenPosSessionForOutlet(outletId, businessDate);
  }

  public SalesDtos.SaleView approveSale(long saleId, Long actorUserId) {
    return approveSale(saleId, actorUserId, false);
  }

  /**
   * Approve overload with allowOversell:
   * <ul>
   *   <li>{@code false} (API path): rejects with 409 if any required item has insufficient stock.</li>
   *   <li>{@code true} (sync path): the offline edge has already taken payment, so we accept the
   *       sale, drive {@code stock_balance.qty_on_hand} negative, set {@code oversell_flag},
   *       record per-item shortages in {@code sale_oversell_line}, and emit
   *       {@code pos.inventory.oversell} for monitoring + manager review.</li>
   * </ul>
   */
  public SalesDtos.SaleView approveSale(long saleId, Long actorUserId, boolean allowOversell) {
    return executeInTransaction(conn -> {
      LockedSaleRecord lockedSale = lockSale(conn, saleId)
          .orElseThrow(() -> ServiceException.notFound("Sale not found: " + saleId));
      if (!isApprovableStatus(lockedSale.status())) {
        throw ServiceException.conflict("Only newly created orders can be approved");
      }
      Long effectiveSessionId = lockedSale.posSessionId();
      if (effectiveSessionId == null) {
        // Public/QR orders are created without a session. Link to the outlet's current open session at approval time
        // so session revenue aggregates include them. Multi-terminal: scope by deviceId when caller is a terminal
        // so the order attributes to the right session.
        RequestUserContext context = RequestUserContextHolder.get();
        Long deviceId = context == null ? null : context.deviceId();
        Optional<Long> sessionLookup = deviceId != null
            ? sessionRepository.findOpenPosSessionIdForOutletAndDeviceTx(conn, lockedSale.outletId(), deviceId)
            : sessionRepository.findOpenPosSessionIdForOutlet(conn, lockedSale.outletId());
        effectiveSessionId = sessionLookup.orElseThrow(() -> ServiceException.conflict(
            "No open POS session for outlet " + lockedSale.outletId()
                + (deviceId != null ? " device " + deviceId : "")
                + " — open a session before approving customer orders"));
      }
      Map<Long, AggregatedSaleLine> aggregatedLines = loadSaleLinesForInventory(conn, saleId, lockedSale.createdAt());
      InventoryPlan plan = buildInventoryPlan(conn, lockedSale.outletId(), aggregatedLines, true);
      List<java.util.Map<String, Object>> shortages = plan.shortages();
      boolean oversell = !shortages.isEmpty();
      if (oversell && !allowOversell) {
        throw ServiceException.conflict(
            "One or more items no longer have enough stock to approve this order", shortages);
      }
      try (PreparedStatement ps = conn.prepareStatement(
          """
          UPDATE core.sale_record
          SET status = 'order_approved'::sale_order_status_enum,
              payment_status = 'unpaid'::payment_status_enum,
              pos_session_id = COALESCE(pos_session_id, ?),
              oversell_flag = (oversell_flag OR ?),
              updated_at = NOW()
          WHERE id = ?
          """
      )) {
        ps.setLong(1, effectiveSessionId);
        ps.setBoolean(2, oversell);
        ps.setLong(3, saleId);
        ps.executeUpdate();
      }
      if (oversell) {
        recordOversellShortages(conn, saleId, lockedSale.createdAt(), shortages);
        appendOversellOutbox(conn, saleId, lockedSale.outletId(), lockedSale.currencyCode(), shortages);
      }
      applySaleUsageInventory(
          conn,
          saleId,
          lockedSale.createdAt(),
          lockedSale.outletId(),
          lockedSale.businessDate(),
          clock.instant(),
          actorUserId,
          allowOversell,
          plan
      );
      SalesDtos.SaleView approved = findSale(conn, saleId)
          .orElseThrow(() -> new IllegalStateException("Approved sale not found"));
      appendSaleApprovedOutbox(conn, approved, lockedSale.businessDate(), actorUserId, allowOversell, oversell);
      return approved;
    });
  }

  public SalesDtos.SaleView approvePublicOrderBatch(long batchId, Long actorUserId) {
    return executeInTransaction(conn -> {
      PublicOrderBatchRecord batch = lockPublicOrderBatch(conn, batchId)
          .orElseThrow(() -> ServiceException.notFound("Public order batch not found: " + batchId));
      if (!"pending".equalsIgnoreCase(batch.status())) {
        if (batch.saleId() != null) {
          return findSale(conn, batch.saleId())
              .orElseThrow(() -> new IllegalStateException("Approved batch sale not found"));
        }
        throw ServiceException.conflict("Only pending QR order batches can be approved");
      }
      List<PublicOrderBatchItemRecord> batchItems = loadPublicOrderBatchItemRecords(conn, batchId);
      if (batchItems.isEmpty()) {
        throw ServiceException.conflict("Cannot approve an empty QR order batch");
      }

      Optional<Long> sessionLookup = sessionRepository.findOpenPosSessionIdForOutlet(conn, batch.outletId());
      long sessionId = sessionLookup.orElseThrow(() -> ServiceException.conflict(
          "No open POS session for outlet " + batch.outletId() + " — open a session before approving customer orders"));
      long saleId = findOpenTableSaleId(conn, batch.orderingTableId()).orElse(0L);
      SalesDtos.SaleView sale;
      if (saleId == 0L) {
        sale = submitSale(conn, new SalesDtos.SubmitSaleRequest(
            batch.outletId(),
            sessionId,
            batch.currencyCode(),
            "online",
            buildPublicOrderNote(batch.tableCode(), batch.tableName(), batch.note()),
            batchItems.stream().map(item -> new SalesDtos.SaleLineRequest(
                item.productId(),
                item.quantity(),
                item.discountAmount(),
                item.taxAmount(),
                item.note(),
                Set.of(),
                null,
                null,
                null
            )).toList(),
            null
        ), batch.businessDate(), new PublicOrderMetadata(batch.orderingTableId(), batch.orderToken()));
        saleId = Long.parseLong(sale.id());
        final long createdSaleId = saleId;
        LockedSaleRecord lockedSale = lockSale(conn, saleId)
            .orElseThrow(() -> ServiceException.notFound("Sale not found: " + createdSaleId));
        Map<Long, AggregatedSaleLine> aggregatedLines = loadSaleLinesForInventory(conn, saleId, lockedSale.createdAt());
        InventoryPlan plan = buildInventoryPlan(conn, batch.outletId(), aggregatedLines, true);
        if (!plan.shortages().isEmpty()) {
          throw ServiceException.conflict("One or more items no longer have enough stock to approve this order", plan.shortages());
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
        applySaleUsageInventory(
            conn,
            saleId,
            lockedSale.createdAt(),
            batch.outletId(),
            lockedSale.businessDate(),
            clock.instant(),
            actorUserId,
            false,
            plan
        );
        sale = findSale(conn, saleId)
            .orElseThrow(() -> new IllegalStateException("Approved table sale not found"));
      } else {
        final long existingSaleId = saleId;
        LockedSaleRecord lockedSale = lockSale(conn, saleId)
            .orElseThrow(() -> ServiceException.notFound("Sale not found: " + existingSaleId));
        Map<Long, AggregatedSaleLine> aggregatedLines = new LinkedHashMap<>();
        for (PublicOrderBatchItemRecord item : batchItems) {
          aggregatedLines.put(item.productId(), new AggregatedSaleLine(
              item.productId(),
              item.quantity(),
              item.unitPrice(),
              item.discountAmount(),
              item.taxAmount(),
              Set.of(),
              item.note(),
              null,
              null,
              Set.of()
          ));
        }
        InventoryPlan plan = buildInventoryPlan(conn, batch.outletId(), aggregatedLines, true);
        if (!plan.shortages().isEmpty()) {
          throw ServiceException.conflict("One or more items no longer have enough stock to approve this order", plan.shortages());
        }
        appendBatchItemsToSale(conn, saleId, lockedSale.createdAt(), batch.outletId(), batchItems);
        recalculateSaleTotalsFromItems(conn, saleId);
        applySaleUsageInventory(
            conn,
            saleId,
            lockedSale.createdAt(),
            batch.outletId(),
            lockedSale.businessDate(),
            clock.instant(),
            actorUserId,
            false,
            plan
        );
        sale = findSale(conn, saleId)
            .orElseThrow(() -> new IllegalStateException("Updated table sale not found"));
      }

      try (PreparedStatement ps = conn.prepareStatement(
          """
          UPDATE core.public_order_batch
          SET sale_id = ?,
              status = 'approved',
              approved_at = NOW(),
              approved_by = ?,
              updated_at = NOW()
          WHERE id = ?
          """
      )) {
        ps.setLong(1, saleId);
        if (actorUserId == null) ps.setNull(2, Types.BIGINT); else ps.setLong(2, actorUserId);
        ps.setLong(3, batchId);
        ps.executeUpdate();
      }
      try (PreparedStatement ps = conn.prepareStatement(
          "UPDATE core.public_order_batch_item SET status = 'approved', updated_at = NOW() WHERE batch_id = ?"
      )) {
        ps.setLong(1, batchId);
        ps.executeUpdate();
      }
      return sale;
    });
  }

  public void rejectPublicOrderBatch(long batchId, String reason, Long actorUserId) {
    executeInTransaction(conn -> {
      PublicOrderBatchRecord batch = lockPublicOrderBatch(conn, batchId)
          .orElseThrow(() -> ServiceException.notFound("Public order batch not found: " + batchId));
      if (!"pending".equalsIgnoreCase(batch.status())) {
        throw ServiceException.conflict("Only pending QR order batches can be rejected");
      }
      try (PreparedStatement ps = conn.prepareStatement(
          """
          UPDATE core.public_order_batch
          SET status = 'rejected',
              rejected_at = NOW(),
              rejected_by = ?,
              rejection_reason = ?,
              updated_at = NOW()
          WHERE id = ?
          """
      )) {
        if (actorUserId == null) ps.setNull(1, Types.BIGINT); else ps.setLong(1, actorUserId);
        ps.setString(2, trimToNull(reason));
        ps.setLong(3, batchId);
        ps.executeUpdate();
      }
      try (PreparedStatement ps = conn.prepareStatement(
          "UPDATE core.public_order_batch_item SET status = 'rejected', updated_at = NOW() WHERE batch_id = ?"
      )) {
        ps.setLong(1, batchId);
        ps.executeUpdate();
      }
      return null;
    });
  }

  private void appendBatchItemsToSale(
      Connection conn,
      long saleId,
      Instant saleCreatedAt,
      long outletId,
      List<PublicOrderBatchItemRecord> items
  ) throws Exception {
    for (PublicOrderBatchItemRecord item : items) {
      BigDecimal lineTotal = item.unitPrice().multiply(item.quantity())
          .subtract(item.discountAmount()).add(item.taxAmount()).setScale(2, RoundingMode.HALF_UP);
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.sale_item (
            sale_id, sale_created_at, outlet_id, product_id,
            unit_price, qty, discount_amount, tax_amount, line_total, note, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
          ON CONFLICT (sale_id, sale_created_at, product_id) DO UPDATE
          SET qty = core.sale_item.qty + EXCLUDED.qty,
              discount_amount = core.sale_item.discount_amount + EXCLUDED.discount_amount,
              tax_amount = core.sale_item.tax_amount + EXCLUDED.tax_amount,
              line_total = core.sale_item.line_total + EXCLUDED.line_total,
              note = COALESCE(NULLIF(core.sale_item.note, ''), EXCLUDED.note),
              updated_at = NOW()
          """
      )) {
        ps.setLong(1, saleId);
        ps.setTimestamp(2, Timestamp.from(saleCreatedAt));
        ps.setLong(3, outletId);
        ps.setLong(4, item.productId());
        ps.setBigDecimal(5, item.unitPrice());
        ps.setBigDecimal(6, item.quantity());
        ps.setBigDecimal(7, item.discountAmount());
        ps.setBigDecimal(8, item.taxAmount());
        ps.setBigDecimal(9, lineTotal);
        ps.setString(10, item.note());
        ps.executeUpdate();
      }
    }
  }

  private void recalculateSaleTotalsFromItems(Connection conn, long saleId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        UPDATE core.sale_record sr
        SET subtotal = agg.subtotal,
            discount = agg.discount,
            tax_amount = agg.tax_amount,
            total_amount = agg.total_amount,
            updated_at = NOW()
        FROM (
          SELECT
            COALESCE(SUM(unit_price * qty), 0) AS subtotal,
            COALESCE(SUM(discount_amount), 0) AS discount,
            COALESCE(SUM(tax_amount), 0) AS tax_amount,
            COALESCE(SUM(line_total), 0) AS total_amount
          FROM core.sale_item
          WHERE sale_id = ?
        ) agg
        WHERE sr.id = ?
        """
    )) {
      ps.setLong(1, saleId);
      ps.setLong(2, saleId);
      ps.executeUpdate();
    }
  }

  private Optional<Long> findOpenTableSaleId(Connection conn, long orderingTableId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT id
        FROM core.sale_record
        WHERE ordering_table_id = ?
          AND status = 'order_approved'::sale_order_status_enum
          AND payment_status = 'unpaid'::payment_status_enum
        ORDER BY created_at ASC, id ASC
        LIMIT 1
        FOR UPDATE
        """
    )) {
      ps.setLong(1, orderingTableId);
      try (ResultSet rs = ps.executeQuery()) {
        return rs.next() ? Optional.of(rs.getLong("id")) : Optional.empty();
      }
    }
  }

  private void appendSaleApprovedOutbox(
      Connection conn,
      SalesDtos.SaleView sale,
      LocalDate businessDate,
      Long actorUserId,
      boolean allowOversell,
      boolean oversell
  ) {
    if (outboxWriter == null) return;
    long saleId = Long.parseLong(sale.id());
    SaleApprovedEvent event = new SaleApprovedEvent(
        saleId,
        sale.outletId(),
        businessDate,
        sale.createdAt(),
        actorUserId,
        allowOversell,
        oversell,
        sale.items().stream()
            .map(i -> new SaleCompletedLineItem(
                i.productId(), i.quantity(), i.unitPrice(),
                i.discountAmount(), i.taxAmount(), i.lineTotal()))
            .toList(),
        clock.instant()
    );
    outboxWriter.append(conn, "sale", saleId, "fern.sales.sale-approved", sale.id(), event);
  }

  private void recordOversellShortages(
      Connection conn,
      long saleId,
      Instant saleCreatedAt,
      List<java.util.Map<String, Object>> shortages
  ) throws Exception {
    String sql = """
        INSERT INTO core.sale_oversell_line
          (sale_id, sale_created_at, item_id, product_id, required_qty, available_qty, short_qty)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (sale_id, item_id, product_id) DO NOTHING
        """;
    for (java.util.Map<String, Object> shortage : shortages) {
      long itemId = Long.parseLong(String.valueOf(shortage.get("itemId")));
      Long productId = null;
      Object productIdsObj = shortage.get("productIds");
      if (productIdsObj instanceof List<?> list && !list.isEmpty()) {
        productId = Long.parseLong(String.valueOf(list.get(0)));
      }
      BigDecimal requiredQty = (BigDecimal) shortage.get("requiredQuantity");
      BigDecimal availableQty = (BigDecimal) shortage.get("availableQuantity");
      BigDecimal shortQty = (BigDecimal) shortage.get("shortQuantity");
      try (PreparedStatement ps = conn.prepareStatement(sql)) {
        ps.setLong(1, saleId);
        ps.setTimestamp(2, Timestamp.from(saleCreatedAt));
        ps.setLong(3, itemId);
        if (productId == null) {
          ps.setNull(4, Types.BIGINT);
        } else {
          ps.setLong(4, productId);
        }
        ps.setBigDecimal(5, requiredQty);
        ps.setBigDecimal(6, availableQty);
        ps.setBigDecimal(7, shortQty);
        ps.executeUpdate();
      }
    }
  }

  private void appendOversellOutbox(
      Connection conn,
      long saleId,
      long outletId,
      String currencyCode,
      List<java.util.Map<String, Object>> shortages
  ) {
    if (outboxWriter == null) return;
    List<com.fern.events.sales.InventoryOversellEvent.OversellShortage> items = new ArrayList<>();
    for (java.util.Map<String, Object> shortage : shortages) {
      long itemId = Long.parseLong(String.valueOf(shortage.get("itemId")));
      Long productId = null;
      Object productIdsObj = shortage.get("productIds");
      if (productIdsObj instanceof List<?> list && !list.isEmpty()) {
        productId = Long.parseLong(String.valueOf(list.get(0)));
      }
      items.add(new com.fern.events.sales.InventoryOversellEvent.OversellShortage(
          itemId,
          productId,
          (BigDecimal) shortage.get("requiredQuantity"),
          (BigDecimal) shortage.get("availableQuantity"),
          (BigDecimal) shortage.get("shortQuantity")
      ));
    }
    com.fern.events.sales.InventoryOversellEvent event =
        new com.fern.events.sales.InventoryOversellEvent(
            saleId, outletId, currencyCode, items, clock.instant());
    outboxWriter.append(conn, "sale", saleId, "fern.sales.inventory-oversell",
        Long.toString(saleId), event);
  }

  private void applySaleUsageInventory(
      Connection conn,
      long saleId,
      Instant saleCreatedAt,
      long outletId,
      LocalDate businessDate,
      Instant txnTime,
      Long actorUserId,
      boolean allowOversell,
      InventoryPlan plan
  ) throws Exception {
    if (plan.movements().isEmpty()) {
      return;
    }
    if (allowOversell) {
      try (PreparedStatement ps = conn.prepareStatement("SELECT set_config('fern.allow_oversell', 'true', true)")) {
        ps.executeQuery();
      }
    }
    for (SaleUsageMovement movement : plan.movements()) {
      if (saleItemTransactionExists(conn, saleId, movement.productId(), movement.itemId())) {
        continue;
      }
      long transactionId = snowflakeIdGenerator.generateId();
      insertInventoryTransaction(
          conn,
          transactionId,
          outletId,
          movement.itemId(),
          movement.qtyChange(),
          businessDate,
          txnTime,
          "sale_usage",
          currentUnitCost(conn, outletId, movement.itemId()),
          actorUserId,
          "Sale " + saleId + " product " + movement.productId()
      );
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.sale_item_transaction (
            inventory_transaction_id, sale_id, sale_created_at, product_id, item_id, txn_time
          ) VALUES (?, ?, ?, ?, ?, ?)
          """
      )) {
        ps.setLong(1, transactionId);
        ps.setLong(2, saleId);
        ps.setTimestamp(3, Timestamp.from(saleCreatedAt));
        ps.setLong(4, movement.productId());
        ps.setLong(5, movement.itemId());
        ps.setTimestamp(6, Timestamp.from(txnTime));
        ps.executeUpdate();
      }
    }
  }

  private boolean saleItemTransactionExists(Connection conn, long saleId, long productId, long itemId)
      throws SQLException {
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
      long transactionId,
      long outletId,
      long itemId,
      BigDecimal qtyChange,
      LocalDate businessDate,
      Instant txnTime,
      String txnType,
      BigDecimal unitCost,
      Long createdByUserId,
      String note
  ) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        INSERT INTO core.inventory_transaction (
          id, outlet_id, item_id, qty_change, business_date, txn_time, txn_type,
          unit_cost, created_by_user_id, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?::inventory_txn_type_enum, ?, ?, ?)
        """
    )) {
      ps.setLong(1, transactionId);
      ps.setLong(2, outletId);
      ps.setLong(3, itemId);
      ps.setBigDecimal(4, qtyChange);
      ps.setObject(5, businessDate);
      ps.setTimestamp(6, Timestamp.from(txnTime));
      ps.setString(7, txnType);
      ps.setBigDecimal(8, unitCost);
      if (createdByUserId == null) {
        ps.setNull(9, Types.BIGINT);
      } else {
        ps.setLong(9, createdByUserId);
      }
      ps.setString(10, note);
      ps.executeUpdate();
    }
  }

  Optional<Long> findOpenPosSessionIdForOutlet(Connection conn, long outletId) throws Exception {
    return sessionRepository.findOpenPosSessionIdForOutlet(conn, outletId);
  }

  // Scoped lookup for multi-terminal outlets — picks the open session belonging to a specific device.
  // Use when an order originates from a known terminal so revenue is attributed to the right session.
  public Optional<Long> findOpenPosSessionIdForOutletAndDevice(long outletId, long deviceId) {
    return sessionRepository.findOpenPosSessionIdForOutletAndDevice(outletId, deviceId);
  }

  Optional<Long> findOpenPosSessionIdForOutletAndDeviceTx(Connection conn, long outletId, long deviceId) throws Exception {
    return sessionRepository.findOpenPosSessionIdForOutletAndDeviceTx(conn, outletId, deviceId);
  }

  private void lockSyncEntity(Connection conn, long entityId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement("SELECT pg_advisory_xact_lock(?)")) {
      ps.setLong(1, entityId);
      ps.executeQuery();
    }
  }

  public SalesDtos.SaleView markPaymentDone(long saleId, SalesDtos.MarkPaymentDoneRequest request) {
    return markPaymentDone(saleId, request, null, null, false);
  }

  public SalesDtos.SaleView markPaymentDone(
      long saleId,
      SalesDtos.MarkPaymentDoneRequest request,
      Long deviceId,
      Instant offlineCapturedAt,
      boolean fromOfflineSync
  ) {
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
      Long resolvedDeviceId = resolveRegisteredDeviceId(conn, deviceId, lockedSale.outletId());
      paymentRepository.upsertPayment(
          conn,
          saleId,
          lockedSale.outletId(),
          lockedSale.createdAt(),
          lockedSale.posSessionId(),
          request,
          amount,
          paymentTime,
          resolvedDeviceId,
          offlineCapturedAt,
          fromOfflineSync
      );
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
      SalesDtos.SaleView paid = findSale(conn, saleId)
          .orElseThrow(() -> new IllegalStateException("Paid sale not found"));
      appendSaleCompletedOutbox(conn, paid, lockedSale.businessDate());
      return paid;
    });
  }

  private void appendSaleCompletedOutbox(java.sql.Connection conn, SalesDtos.SaleView sale, LocalDate businessDate) {
    if (outboxWriter == null) return;
    long saleId = Long.parseLong(sale.id());
    SaleCompletedEvent saleEvent = new SaleCompletedEvent(
        saleId,
        sale.outletId(),
        businessDate,
        sale.currencyCode(),
        sale.items().stream()
            .map(i -> new SaleCompletedLineItem(
                i.productId(), i.quantity(), i.unitPrice(),
                i.discountAmount(), i.taxAmount(), i.lineTotal()))
            .toList(),
        sale.subtotal(), sale.discount(), sale.taxAmount(), sale.totalAmount(),
        clock.instant()
    );
    outboxWriter.append(conn, "sale", saleId, "fern.sales.sale-completed",
        sale.id(), saleEvent);

    if (sale.payment() != null && "success".equalsIgnoreCase(sale.payment().status())) {
      PaymentCapturedEvent payEvent = new PaymentCapturedEvent(
          saleId,
          sale.payment().paymentMethod(),
          sale.payment().amount(),
          sale.currencyCode(),
          sale.payment().paymentTime(),
          sale.payment().transactionRef()
      );
      outboxWriter.append(conn, "sale", saleId, "fern.sales.payment-captured",
          sale.id(), payEvent);
    }
  }

  public SalesDtos.SaleView cancelSale(long saleId, String reason, Long actorUserId) {
    return cancelSale(saleId, reason, null, null, null, actorUserId);
  }

  public SalesDtos.SaleView cancelSale(
      long saleId,
      String reason,
      String reasonCode,
      Long managerUserId,
      String voidNote,
      Long actorUserId
  ) {
    return executeInTransaction(conn -> {
      LockedSaleRecord lockedSale = lockSale(conn, saleId)
          .orElseThrow(() -> ServiceException.notFound("Sale not found: " + saleId));
      String status = lockedSale.status().toLowerCase(Locale.ROOT);
      if ("cancelled".equals(status)) {
        return findSale(conn, saleId)
            .orElseThrow(() -> new IllegalStateException("Cancelled sale not found"));
      }
      boolean inventoryApplied = "order_approved".equalsIgnoreCase(status)
          || "payment_done".equalsIgnoreCase(status)
          || "completed".equalsIgnoreCase(status);
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

      // Resolve reason metadata if a structured code is supplied; enforce manager approval.
      VoidReasonRecord reasonRecord = null;
      final String resolvedReasonCode =
          (reasonCode == null || reasonCode.isBlank()) ? "CUSTOMER_REFUSED" : reasonCode;
      reasonRecord = loadVoidReason(conn, resolvedReasonCode)
          .orElseThrow(() -> ServiceException.badRequest("Unknown void reason: " + resolvedReasonCode));
      if (reasonRecord.requiresManagerApproval && managerUserId == null) {
        throw ServiceException.badRequest("Manager approval required for reason: " + resolvedReasonCode);
      }
      if (reasonRecord.requiresManagerApproval
          && actorUserId != null
          && managerUserId != null
          && managerUserId.equals(actorUserId)) {
        throw ServiceException.badRequest("Manager approver must differ from cashier");
      }

      String cancellationNote = buildCancellationNote(lockedSale.note(), reason, actorUserId);
      try (PreparedStatement ps = conn.prepareStatement(
          """
          UPDATE core.sale_record
          SET status            = 'cancelled'::sale_order_status_enum,
              payment_status    = 'unpaid'::payment_status_enum,
              note              = COALESCE(?, note),
              void_reason_code  = COALESCE(?, void_reason_code),
              voided_by         = COALESCE(?, voided_by),
              voided_at         = COALESCE(voided_at, NOW()),
              void_approved_by  = COALESCE(?, void_approved_by),
              void_approved_at  = CASE WHEN ? IS NOT NULL THEN NOW() ELSE void_approved_at END,
              void_note         = COALESCE(?, void_note),
              updated_at        = NOW()
          WHERE id = ?
          """
      )) {
        ps.setString(1, cancellationNote);
        if (resolvedReasonCode != null) ps.setString(2, resolvedReasonCode); else ps.setNull(2, java.sql.Types.VARCHAR);
        if (actorUserId != null) ps.setLong(3, actorUserId); else ps.setNull(3, java.sql.Types.BIGINT);
        if (managerUserId != null) ps.setLong(4, managerUserId); else ps.setNull(4, java.sql.Types.BIGINT);
        if (managerUserId != null) ps.setLong(5, managerUserId); else ps.setNull(5, java.sql.Types.BIGINT);
        if (voidNote != null) ps.setString(6, voidNote); else ps.setNull(6, java.sql.Types.VARCHAR);
        ps.setLong(7, saleId);
        ps.executeUpdate();
      }
      SalesDtos.SaleView cancelled = findSale(conn, saleId)
          .orElseThrow(() -> new IllegalStateException("Cancelled sale not found"));
      if (inventoryApplied && (reasonRecord == null || reasonRecord.reversesInventory)) {
        appendSaleCancelledOutbox(conn, lockedSale, actorUserId, reason);
      }
      return cancelled;
    });
  }

  public java.util.List<SalesDtos.VoidReasonView> listVoidReasons() {
    return executeInTransaction(conn -> {
      java.util.List<SalesDtos.VoidReasonView> out = new java.util.ArrayList<>();
      try (PreparedStatement ps = conn.prepareStatement(
          """
          SELECT code, label, description, requires_manager_approval, reverses_inventory, category, sort_order
          FROM core.void_reason
          WHERE active = true
          ORDER BY sort_order, code
          """
      )) {
        try (ResultSet rs = ps.executeQuery()) {
          while (rs.next()) {
            out.add(new SalesDtos.VoidReasonView(
                rs.getString("code"),
                rs.getString("label"),
                rs.getString("description"),
                rs.getBoolean("requires_manager_approval"),
                rs.getBoolean("reverses_inventory"),
                rs.getString("category"),
                rs.getInt("sort_order")
            ));
          }
        }
      }
      return out;
    });
  }

  private java.util.Optional<VoidReasonRecord> loadVoidReason(Connection conn, String code) throws SQLException {
    try (PreparedStatement ps = conn.prepareStatement(
        "SELECT requires_manager_approval, reverses_inventory FROM core.void_reason WHERE code = ? AND active = true"
    )) {
      ps.setString(1, code);
      try (ResultSet rs = ps.executeQuery()) {
        if (rs.next()) {
          return java.util.Optional.of(new VoidReasonRecord(
              rs.getBoolean("requires_manager_approval"),
              rs.getBoolean("reverses_inventory")
          ));
        }
        return java.util.Optional.empty();
      }
    }
  }

  private record VoidReasonRecord(boolean requiresManagerApproval, boolean reversesInventory) {}

  private void appendSaleCancelledOutbox(
      Connection conn,
      LockedSaleRecord sale,
      Long actorUserId,
      String reason
  ) {
    if (outboxWriter == null) return;
    SaleCancelledEvent event = new SaleCancelledEvent(
        sale.saleId(),
        sale.outletId(),
        sale.businessDate(),
        sale.createdAt(),
        actorUserId,
        reason,
        clock.instant()
    );
    outboxWriter.append(conn, "sale", sale.saleId(), "fern.sales.sale-cancelled", Long.toString(sale.saleId()), event);
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
            pay.payment_method,
            COUNT(*) OVER() AS total_count
          FROM core.sale_record sr
          LEFT JOIN core.ordering_table t ON t.id = sr.ordering_table_id
          LEFT JOIN LATERAL (
            SELECT p.payment_method::text AS payment_method
            FROM core.payment p
            WHERE p.sale_id = sr.id
              AND p.status = 'success'::payment_txn_status_enum
            ORDER BY p.payment_time DESC NULLS LAST, p.sale_created_at DESC
            LIMIT 1
          ) pay ON true
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
    return sessionRepository.listPosSessions(
        outletIds,
        businessDate,
        startDate,
        endDate,
        status,
        managerId,
        q,
        sortBy,
        sortDir,
        limit,
        offset
    );
  }

  public SalesDtos.OutletStatsView getOutletStats(long outletId, LocalDate businessDate) {
    return executeInTransaction(conn -> {
      ZoneId outletZone = ZoneId.of(findOutletTimezone(conn, outletId));
      Instant start = businessDate.atStartOfDay(outletZone).toInstant();
      Instant end = businessDate.plusDays(1).atStartOfDay(outletZone).toInstant();

      long ordersToday = 0;
      long completedSales = 0;
      long cancelledOrders = 0;
      BigDecimal revenueToday = BigDecimal.ZERO;
      String currencyCode = "VND";

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

      try (PreparedStatement ps = conn.prepareStatement(
          """
          SELECT COALESCE(
            (
              SELECT sr.currency_code
              FROM core.sale_record sr
              WHERE sr.outlet_id = ?
                AND sr.created_at >= ?
                AND sr.created_at < ?
              ORDER BY sr.created_at DESC
              LIMIT 1
            ),
            (
              SELECT pp.currency_code
              FROM core.product_price pp
              WHERE pp.outlet_id = ?
              ORDER BY pp.effective_from DESC
              LIMIT 1
            ),
            'VND'
          ) AS currency_code
          """
      )) {
        ps.setLong(1, outletId);
        ps.setTimestamp(2, Timestamp.from(start));
        ps.setTimestamp(3, Timestamp.from(end));
        ps.setLong(4, outletId);
        try (ResultSet rs = ps.executeQuery()) {
          if (rs.next()) {
            String resolvedCurrency = rs.getString("currency_code");
            if (resolvedCurrency != null && !resolvedCurrency.isBlank()) {
              currencyCode = resolvedCurrency;
            }
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
            EXTRACT(HOUR FROM created_at AT TIME ZONE ?)::int AS hour_of_day,
            COALESCE(SUM(CASE WHEN status IN ('payment_done'::sale_order_status_enum, 'completed'::sale_order_status_enum) THEN total_amount ELSE 0 END), 0) AS revenue
          FROM core.sale_record
          WHERE outlet_id = ?
            AND created_at >= ?
            AND created_at < ?
          GROUP BY hour_of_day
          ORDER BY hour_of_day
          """
      )) {
        ps.setString(1, outletZone.getId());
        ps.setLong(2, outletId);
        ps.setTimestamp(3, Timestamp.from(start));
        ps.setTimestamp(4, Timestamp.from(end));
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
          currencyCode,
          activeSessionCode,
          activeSessionStatus,
          topCategory,
          String.format("%02d:00", peakHourValue),
          hourlyRevenue
      );
    });
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
    // Feature flag: when sales.inventory.read-mode=service AND not locking, delegate
    // to inventory-service so we don't hold row locks on core.stock_balance.
    if (readModeService && !lockRows && availabilityClient != null && !itemIds.isEmpty()) {
      try {
        return availabilityClient.available(outletId, new java.util.ArrayList<>(itemIds));
      } catch (Exception e) {
        // Fail open to direct DB read; alert via metric in caller's path.
      }
    }
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
      BigDecimal basePrice = resolveUnitPrice(conn, line.productId(), request.outletId(), businessDate);
      Set<Long> promotionIds = line.promotionIds() == null ? Set.of() : Set.copyOf(line.promotionIds());
      Set<Long> modifierOptionIds = line.modifierOptionIds() == null ? Set.of() : Set.copyOf(line.modifierOptionIds());
      BigDecimal variantDelta = line.variantId() != null
          ? resolveVariantDelta(conn, line.variantId(), basePrice)
          : BigDecimal.ZERO;
      BigDecimal modifierDelta = resolveModifierDelta(conn, modifierOptionIds);
      BigDecimal unitPrice = basePrice.add(variantDelta).add(modifierDelta);
      AggregatedSaleLine current = aggregated.get(line.productId());
      if (current == null) {
        aggregated.put(line.productId(), new AggregatedSaleLine(
            line.productId(),
            line.quantity(),
            unitPrice,
            money(line.discountAmount()),
            money(line.taxAmount()),
            promotionIds,
            trimToNull(line.note()),
            line.variantId(),
            trimToNull(line.variantName()),
            modifierOptionIds
        ));
      } else {
        if (!java.util.Objects.equals(current.variantId(), line.variantId())) {
          throw ServiceException.conflict("Each product may only appear once per sale in this POS flow");
        }
        Set<Long> mergedPromotionIds = new LinkedHashSet<>(current.promotionIds());
        mergedPromotionIds.addAll(promotionIds);
        Set<Long> mergedModifierOptionIds = new LinkedHashSet<>(current.modifierOptionIds());
        mergedModifierOptionIds.addAll(modifierOptionIds);
        aggregated.put(line.productId(), new AggregatedSaleLine(
            line.productId(),
            current.quantity().add(line.quantity()),
            unitPrice,
            current.discountAmount().add(money(line.discountAmount())),
            current.taxAmount().add(money(line.taxAmount())),
            Set.copyOf(mergedPromotionIds),
            current.note(),
            current.variantId(),
            current.variantName(),
            Set.copyOf(mergedModifierOptionIds)
        ));
      }
    }
    return aggregated;
  }

  private void insertSaleItems(
      Connection conn, long saleId, long outletId, Instant saleCreatedAt,
      Iterable<AggregatedSaleLine> lines, Instant now) throws Exception {
    for (AggregatedSaleLine line : lines) {
      BigDecimal lineTotal = line.unitPrice()
          .multiply(line.quantity())
          .subtract(line.discountAmount())
          .add(line.taxAmount())
          .setScale(2, RoundingMode.HALF_UP);
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.sale_item (
            sale_id, sale_created_at, outlet_id, product_id,
            unit_price, qty, discount_amount, tax_amount, line_total, note, variant_id, variant_name,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          """
      )) {
        ps.setLong(1, saleId);
        ps.setTimestamp(2, Timestamp.from(saleCreatedAt));
        ps.setLong(3, outletId);
        ps.setLong(4, line.productId());
        ps.setBigDecimal(5, line.unitPrice());
        ps.setBigDecimal(6, line.quantity());
        ps.setBigDecimal(7, line.discountAmount().setScale(2, RoundingMode.HALF_UP));
        ps.setBigDecimal(8, line.taxAmount().setScale(2, RoundingMode.HALF_UP));
        ps.setBigDecimal(9, lineTotal);
        ps.setString(10, line.note());
        if (line.variantId() == null) {
          ps.setNull(11, Types.BIGINT);
        } else {
          ps.setLong(11, line.variantId());
        }
        ps.setString(12, line.variantName());
        ps.setTimestamp(13, Timestamp.from(now));
        ps.setTimestamp(14, Timestamp.from(now));
        ps.executeUpdate();
      }
    }
  }

  private void insertSaleItemModifiers(
      Connection conn,
      long saleId,
      Instant saleCreatedAt,
      Iterable<AggregatedSaleLine> lines,
      Instant now
  ) throws Exception {
    for (AggregatedSaleLine line : lines) {
      if (line.modifierOptionIds() == null || line.modifierOptionIds().isEmpty()) continue;
      for (Long modifierOptionId : line.modifierOptionIds()) {
        try (PreparedStatement ps = conn.prepareStatement(
            """
            INSERT INTO core.sale_item_modifier (
              sale_id, sale_created_at, product_id, modifier_option_id,
              group_code, group_name, option_code, option_name, price_add_amount, created_at
            )
            SELECT ?, ?, ?, mo.id, mg.code, mg.name, mo.code, mo.name, mo.price_adjustment, ?
            FROM core.modifier_option mo
            JOIN core.modifier_group mg ON mg.id = mo.modifier_group_id
            WHERE mo.id = ?
            ON CONFLICT (sale_id, sale_created_at, product_id, modifier_option_id) DO NOTHING
            """
        )) {
          ps.setLong(1, saleId);
          ps.setTimestamp(2, Timestamp.from(saleCreatedAt));
          ps.setLong(3, line.productId());
          ps.setTimestamp(4, Timestamp.from(now));
          ps.setLong(5, modifierOptionId);
          ps.executeUpdate();
        }
      }
    }
  }

  private void insertSalePromotions(
      Connection conn, long saleId, Instant saleCreatedAt,
      Iterable<AggregatedSaleLine> lines, Instant now) throws Exception {
    for (AggregatedSaleLine line : lines) {
      for (Long promotionId : line.promotionIds()) {
        try (PreparedStatement ps = conn.prepareStatement(
            """
            INSERT INTO core.sale_item_promotion (sale_id, sale_created_at, product_id, promotion_id, created_at)
            VALUES (?, ?, ?, ?, ?)
            """
        )) {
          ps.setLong(1, saleId);
          ps.setTimestamp(2, Timestamp.from(saleCreatedAt));
          ps.setLong(3, line.productId());
          ps.setLong(4, promotionId);
          ps.setTimestamp(5, Timestamp.from(now));
          ps.executeUpdate();
        }
      }
    }
  }

  private Map<Long, AggregatedSaleLine> loadSaleLinesForInventory(
      Connection conn, long saleId, Instant saleCreatedAt) throws Exception {
    Map<Long, AggregatedSaleLine> aggregated = new LinkedHashMap<>();
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT product_id, qty, unit_price, discount_amount, tax_amount, note
        FROM core.sale_item
        WHERE sale_id = ? AND sale_created_at = ?
        ORDER BY product_id
        """
    )) {
      ps.setLong(1, saleId);
      ps.setTimestamp(2, Timestamp.from(saleCreatedAt));
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
              rs.getString("note"),
              null,
              null,
              Set.of()
          ));
        }
      }
    }
    return aggregated;
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

  private LocalDate currentBusinessDate(Connection conn, long outletId) throws Exception {
    return clock.instant().atZone(ZoneId.of(findOutletTimezone(conn, outletId))).toLocalDate();
  }

  private String findOutletTimezone(Connection conn, long outletId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT COALESCE(NULLIF(r.timezone_name, ''), ?) AS timezone_name
        FROM core.outlet o
        JOIN core.region r ON r.id = o.region_id
        WHERE o.id = ?
        """
    )) {
      ps.setString(1, DEFAULT_OUTLET_TIMEZONE);
      ps.setLong(2, outletId);
      try (ResultSet rs = ps.executeQuery()) {
        if (rs.next()) {
          String timezone = rs.getString("timezone_name");
          return timezone == null || timezone.isBlank() ? DEFAULT_OUTLET_TIMEZONE : timezone;
        }
        return DEFAULT_OUTLET_TIMEZONE;
      }
    }
  }

  private Optional<LockedSaleRecord> lockSale(Connection conn, long saleId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT
          sr.id,
          sr.outlet_id,
          sr.pos_session_id,
          sr.currency_code,
          sr.status,
          sr.total_amount,
          COALESCE(
            ps.business_date,
            (sr.created_at AT TIME ZONE COALESCE(NULLIF(r.timezone_name, ''), ?))::date
          ) AS business_date,
          sr.created_at,
          sr.note
        FROM core.sale_record sr
        JOIN core.outlet o ON o.id = sr.outlet_id
        JOIN core.region r ON r.id = o.region_id
        LEFT JOIN core.pos_session ps ON ps.id = sr.pos_session_id
        WHERE sr.id = ?
        FOR UPDATE OF sr
        """
    )) {
      ps.setString(1, DEFAULT_OUTLET_TIMEZONE);
      ps.setLong(2, saleId);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) {
          return Optional.empty();
        }
        Object posSessionId = rs.getObject("pos_session_id");
        Instant saleCreatedAt = rs.getTimestamp("created_at").toInstant();
        return Optional.of(new LockedSaleRecord(
            rs.getLong("id"),
            rs.getLong("outlet_id"),
            posSessionId == null ? null : ((Number) posSessionId).longValue(),
            rs.getString("currency_code"),
            rs.getString("status"),
            rs.getBigDecimal("total_amount"),
            rs.getObject("business_date", LocalDate.class),
            saleCreatedAt,
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
              paymentRepository.loadPaymentTransactional(conn, saleId).orElse(null)
          ));
        }
        return Optional.empty();
      }
    }
  }

  private List<SalesDtos.SaleLineView> loadSaleItems(long saleId) {
    return queryList(
        """
        SELECT si.sale_id, si.product_id, p.code AS product_code, p.name AS product_name,
               si.unit_price, si.qty, si.discount_amount, si.tax_amount, si.line_total,
               si.note, si.variant_id, si.variant_name
        FROM core.sale_item si
        LEFT JOIN core.product p ON p.id = si.product_id
        WHERE si.sale_id = ?
        ORDER BY si.product_id
        """,
        rs -> mapSaleLine(
            rs,
            loadPromotionIds(saleId, getLong(rs, "product_id")),
            loadSaleItemModifiers(saleId, getLong(rs, "product_id"))
        ),
        saleId
    );
  }

  private List<SalesDtos.SaleLineView> loadSaleItemsTransactional(Connection conn, long saleId) throws Exception {
    List<SalesDtos.SaleLineView> items = new ArrayList<>();
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT si.sale_id, si.product_id, p.code AS product_code, p.name AS product_name,
               si.unit_price, si.qty, si.discount_amount, si.tax_amount, si.line_total,
               si.note, si.variant_id, si.variant_name
        FROM core.sale_item si
        LEFT JOIN core.product p ON p.id = si.product_id
        WHERE si.sale_id = ?
        ORDER BY si.product_id
        """
    )) {
      ps.setLong(1, saleId);
      try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
          items.add(mapSaleLine(
              rs,
              loadPromotionIdsTransactional(conn, saleId, rs.getLong("product_id")),
              loadSaleItemModifiersTransactional(conn, saleId, rs.getLong("product_id"))
          ));
        }
      }
    }
    return List.copyOf(items);
  }

  private List<SalesDtos.SaleLineModifierView> loadSaleItemModifiers(long saleId, long productId) {
    return queryList(
        """
        SELECT modifier_option_id, group_code, group_name, option_code, option_name, price_add_amount
        FROM core.sale_item_modifier
        WHERE sale_id = ? AND product_id = ?
        ORDER BY modifier_option_id
        """,
        rs -> {
          try {
            return new SalesDtos.SaleLineModifierView(
                rs.getLong("modifier_option_id"),
                rs.getString("group_code"),
                rs.getString("group_name"),
                rs.getString("option_code"),
                rs.getString("option_name"),
                rs.getBigDecimal("price_add_amount")
            );
          } catch (SQLException e) {
            throw new IllegalStateException("Unable to map sale line modifier", e);
          }
        },
        saleId, productId
    );
  }

  private List<SalesDtos.SaleLineModifierView> loadSaleItemModifiersTransactional(
      Connection conn,
      long saleId,
      long productId
  ) throws Exception {
    List<SalesDtos.SaleLineModifierView> modifiers = new ArrayList<>();
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT modifier_option_id, group_code, group_name, option_code, option_name, price_add_amount
        FROM core.sale_item_modifier
        WHERE sale_id = ? AND product_id = ?
        ORDER BY modifier_option_id
        """
    )) {
      ps.setLong(1, saleId);
      ps.setLong(2, productId);
      try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
          modifiers.add(new SalesDtos.SaleLineModifierView(
              rs.getLong("modifier_option_id"),
              rs.getString("group_code"),
              rs.getString("group_name"),
              rs.getString("option_code"),
              rs.getString("option_name"),
              rs.getBigDecimal("price_add_amount")
          ));
        }
      }
    }
    return List.copyOf(modifiers);
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

  public java.util.Map<Long, BigDecimal> resolveUnitPrices(java.util.Set<Long> productIds, long outletId, LocalDate businessDate) {
    if (productIds == null || productIds.isEmpty()) return java.util.Map.of();
    return executeInTransaction(conn -> {
      java.util.Map<Long, BigDecimal> out = new java.util.HashMap<>();
      String placeholders = productIds.stream().map(id -> "?").collect(java.util.stream.Collectors.joining(","));
      String sql = "SELECT DISTINCT ON (product_id) product_id, price_value FROM core.product_price"
          + " WHERE product_id IN (" + placeholders + ") AND outlet_id = ?"
          + " AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)"
          + " ORDER BY product_id, effective_from DESC";
      try (PreparedStatement ps = conn.prepareStatement(sql)) {
        int idx = 1;
        for (Long id : productIds) ps.setLong(idx++, id);
        ps.setLong(idx++, outletId);
        ps.setObject(idx++, businessDate);
        ps.setObject(idx, businessDate);
        try (ResultSet rs = ps.executeQuery()) {
          while (rs.next()) {
            out.put(rs.getLong("product_id"), rs.getBigDecimal("price_value"));
          }
        }
      }
      return out;
    });
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

  private BigDecimal resolveVariantDelta(Connection conn, long variantId, BigDecimal basePrice) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        "SELECT price_modifier_type, price_modifier_value FROM core.product_variant WHERE id = ?"
    )) {
      ps.setLong(1, variantId);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) return BigDecimal.ZERO;
        String type = rs.getString("price_modifier_type");
        BigDecimal value = rs.getBigDecimal("price_modifier_value");
        if (value == null) return BigDecimal.ZERO;
        if ("percentage".equals(type)) {
          return basePrice.multiply(value).divide(BigDecimal.valueOf(100), 2, java.math.RoundingMode.HALF_UP);
        }
        if ("fixed".equals(type)) {
          return value;
        }
        return BigDecimal.ZERO;
      }
    }
  }

  private BigDecimal resolveModifierDelta(Connection conn, Set<Long> modifierOptionIds) throws Exception {
    if (modifierOptionIds == null || modifierOptionIds.isEmpty()) return BigDecimal.ZERO;
    String placeholders = modifierOptionIds.stream().map(id -> "?").collect(java.util.stream.Collectors.joining(","));
    try (PreparedStatement ps = conn.prepareStatement(
        "SELECT COALESCE(SUM(price_adjustment), 0) AS total FROM core.modifier_option WHERE id IN (" + placeholders + ")"
    )) {
      int idx = 1;
      for (Long id : modifierOptionIds) {
        ps.setLong(idx++, id);
      }
      try (ResultSet rs = ps.executeQuery()) {
        if (rs.next()) {
          BigDecimal total = rs.getBigDecimal("total");
          return total != null ? total : BigDecimal.ZERO;
        }
        return BigDecimal.ZERO;
      }
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
          rs.getString("payment_method"),
          rs.getTimestamp("created_at").toInstant()
      );
    } catch (Exception e) {
      throw new IllegalStateException("Unable to map sale list item", e);
    }
  }

  private SalesDtos.SaleLineView mapSaleLine(
      ResultSet rs,
      Set<Long> promotionIds,
      List<SalesDtos.SaleLineModifierView> modifiers
  ) {
    try {
      Object variantId = rs.getObject("variant_id");
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
          rs.getString("note"),
          variantId == null ? null : ((Number) variantId).longValue(),
          rs.getString("variant_name"),
          modifiers
      );
    } catch (Exception e) {
      throw new IllegalStateException("Unable to map sale line", e);
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

  private Long resolveRegisteredDeviceId(Connection conn, Long deviceId, long outletId) throws Exception {
    if (deviceId == null) {
      return null;
    }
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT id
        FROM core.device_registry
        WHERE id = ?
          AND outlet_id = ?
          AND revoked_at IS NULL
        LIMIT 1
        """
    )) {
      ps.setLong(1, deviceId);
      ps.setLong(2, outletId);
      try (ResultSet rs = ps.executeQuery()) {
        return rs.next() ? rs.getLong("id") : null;
      }
    }
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
      String note,
      Long variantId,
      String variantName,
      Set<Long> modifierOptionIds
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
      String currencyCode,
      String status,
      BigDecimal totalAmount,
      LocalDate businessDate,
      Instant createdAt,
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
      SalesDtos.SaleView sale,
      Long batchId,
      String batchStatus,
      String batchNote,
      Instant batchCreatedAt,
      List<PublicPosDtos.PublicOrderLineView> batchItems
  ) {
    public CreatedPublicOrder(String orderToken, SalesDtos.SaleView sale) {
      this(orderToken, sale, null, null, null, null, List.of());
    }
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

  private record PublicOrderBatchRecord(
      long id,
      long outletId,
      long orderingTableId,
      Long saleId,
      String orderToken,
      String status,
      String note,
      Instant createdAt,
      String tableCode,
      String tableName,
      String currencyCode,
      LocalDate businessDate
  ) {
  }

  private record PublicOrderBatchItemRecord(
      long productId,
      BigDecimal quantity,
      String note,
      BigDecimal unitPrice,
      BigDecimal discountAmount,
      BigDecimal taxAmount,
      BigDecimal lineTotal,
      String status
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
