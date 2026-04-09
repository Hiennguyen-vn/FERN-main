package com.fern.services.product.infrastructure;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.repository.BaseRepository;
import com.dorabets.common.spring.web.PagedResult;
import com.dorabets.common.spring.web.QueryConventions;
import com.fern.services.product.api.ProductDtos;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import javax.sql.DataSource;
import org.springframework.stereotype.Repository;

@Repository
public class ProductRepository extends BaseRepository {

  private static final Set<String> PRODUCT_SORT_KEYS = Set.of("code", "name", "categoryCode", "status", "updatedAt");
  private static final Set<String> ITEM_SORT_KEYS = Set.of("code", "name", "categoryCode", "status", "updatedAt");
  private static final Set<String> PRICE_SORT_KEYS = Set.of("productCode", "productName", "priceValue", "effectiveFrom");

  private final SnowflakeIdGenerator snowflakeIdGenerator;
  private final Clock clock;

  public ProductRepository(
      DataSource dataSource,
      SnowflakeIdGenerator snowflakeIdGenerator,
      Clock clock
  ) {
    super(dataSource);
    this.snowflakeIdGenerator = snowflakeIdGenerator;
    this.clock = clock;
  }

  public PagedResult<ProductDtos.ProductView> listProducts(
      String status,
      String categoryCode,
      String q,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    return executeInTransaction(conn -> {
      StringBuilder sql = new StringBuilder(
          """
          SELECT id, code, name, category_code, status, image_url, description, updated_at, COUNT(*) OVER() AS total_count
          FROM core.product
          WHERE deleted_at IS NULL
          """
      );
      List<Object> params = new ArrayList<>();
      if (status != null && !status.isBlank()) {
        sql.append(" AND status = ?::product_status_enum");
        params.add(status.trim());
      }
      if (categoryCode != null && !categoryCode.isBlank()) {
        sql.append(" AND category_code = ?");
        params.add(categoryCode.trim());
      }
      if (q != null && !q.isBlank()) {
        sql.append(" AND (code ILIKE ? OR name ILIKE ?)");
        String pattern = "%" + q + "%";
        params.add(pattern);
        params.add(pattern);
      }
      sql.append(" ORDER BY ").append(resolveProductSortClause(sortBy, sortDir)).append(" LIMIT ? OFFSET ?");
      params.add(limit);
      params.add(offset);

      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bind(ps, params);
        try (ResultSet rs = ps.executeQuery()) {
          List<ProductDtos.ProductView> rows = new ArrayList<>();
          long totalCount = 0;
          while (rs.next()) {
            totalCount = rs.getLong("total_count");
            rows.add(mapProduct(rs));
          }
          return PagedResult.of(rows, limit, offset, totalCount);
        }
      }
    });
  }

  public ProductDtos.ProductView createProduct(ProductDtos.CreateProductRequest request, Long actorUserId) {
    return executeInTransaction(conn -> {
      long productId = snowflakeIdGenerator.generateId();
      Instant now = clock.instant();
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.product (
            id, code, name, category_code, status, image_url, description,
            created_by_user_id, updated_by_user_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?::product_status_enum, ?, ?, ?, ?, ?, ?)
          """
      )) {
        ps.setLong(1, productId);
        ps.setString(2, request.code().trim());
        ps.setString(3, request.name().trim());
        ps.setString(4, trimToNull(request.categoryCode()));
        ps.setString(5, "active");
        ps.setString(6, trimToNull(request.imageUrl()));
        ps.setString(7, trimToNull(request.description()));
        if (actorUserId == null) {
          ps.setNull(8, java.sql.Types.BIGINT);
          ps.setNull(9, java.sql.Types.BIGINT);
        } else {
          ps.setLong(8, actorUserId);
          ps.setLong(9, actorUserId);
        }
        ps.setTimestamp(10, Timestamp.from(now));
        ps.setTimestamp(11, Timestamp.from(now));
        ps.executeUpdate();
      } catch (java.sql.SQLException e) {
        if ("23505".equals(e.getSQLState())) {
          throw ServiceException.conflict("Product code already exists");
        }
        throw e;
      }
      return findProductById(conn, productId)
          .orElseThrow(() -> new IllegalStateException("Created product not found: " + productId));
    });
  }

  public PagedResult<ProductDtos.ItemView> listItems(
      String status,
      String categoryCode,
      String q,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    return executeInTransaction(conn -> {
      StringBuilder sql = new StringBuilder(
          """
          SELECT id, code, name, category_code, base_uom_code, min_stock_level, max_stock_level, status, updated_at,
                 COUNT(*) OVER() AS total_count
          FROM core.item
          WHERE deleted_at IS NULL
          """
      );
      List<Object> params = new ArrayList<>();
      if (status != null && !status.isBlank()) {
        sql.append(" AND status = ?::item_status_enum");
        params.add(status.trim());
      }
      if (categoryCode != null && !categoryCode.isBlank()) {
        sql.append(" AND category_code = ?");
        params.add(categoryCode.trim());
      }
      if (q != null && !q.isBlank()) {
        sql.append(" AND (code ILIKE ? OR name ILIKE ?)");
        String pattern = "%" + q + "%";
        params.add(pattern);
        params.add(pattern);
      }
      sql.append(" ORDER BY ").append(resolveItemSortClause(sortBy, sortDir)).append(" LIMIT ? OFFSET ?");
      params.add(limit);
      params.add(offset);

      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bind(ps, params);
        try (ResultSet rs = ps.executeQuery()) {
          List<ProductDtos.ItemView> rows = new ArrayList<>();
          long totalCount = 0;
          while (rs.next()) {
            totalCount = rs.getLong("total_count");
            rows.add(mapItem(rs));
          }
          return PagedResult.of(rows, limit, offset, totalCount);
        }
      }
    });
  }

  public ProductDtos.ItemView createItem(ProductDtos.CreateItemRequest request) {
    return executeInTransaction(conn -> {
      long itemId = snowflakeIdGenerator.generateId();
      Instant now = clock.instant();
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.item (
            id, code, name, category_code, base_uom_code, min_stock_level, max_stock_level, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?::item_status_enum, ?, ?)
          """
      )) {
        ps.setLong(1, itemId);
        ps.setString(2, request.code().trim());
        ps.setString(3, request.name().trim());
        ps.setString(4, trimToNull(request.categoryCode()));
        ps.setString(5, request.baseUomCode().trim());
        ps.setBigDecimal(6, request.minStockLevel());
        ps.setBigDecimal(7, request.maxStockLevel());
        ps.setString(8, "active");
        ps.setTimestamp(9, Timestamp.from(now));
        ps.setTimestamp(10, Timestamp.from(now));
        ps.executeUpdate();
      } catch (java.sql.SQLException e) {
        if ("23505".equals(e.getSQLState())) {
          throw ServiceException.conflict("Item code already exists");
        }
        throw e;
      }
      return findItemById(conn, itemId)
          .orElseThrow(() -> new IllegalStateException("Created item not found: " + itemId));
    });
  }

  public Optional<ProductDtos.PriceView> findPrice(long productId, long outletId, LocalDate onDate) {
    return queryOne(
        """
        SELECT product_id, outlet_id, currency_code, price_value, effective_from, effective_to
        FROM core.product_price
        WHERE product_id = ?
          AND outlet_id = ?
          AND effective_from <= ?
          AND (effective_to IS NULL OR effective_to >= ?)
        ORDER BY effective_from DESC
        LIMIT 1
        """,
        this::mapPrice,
        productId,
        outletId,
        java.sql.Date.valueOf(onDate),
        java.sql.Date.valueOf(onDate)
    );
  }

  public PagedResult<ProductDtos.PriceView> listPrices(
      long outletId,
      Long productId,
      LocalDate onDate,
      String q,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    return executeInTransaction(conn -> {
      StringBuilder sql = new StringBuilder(
          """
          WITH current_prices AS (
            SELECT DISTINCT ON (pp.product_id)
              pp.product_id,
              pp.outlet_id,
              pp.currency_code,
              pp.price_value,
              pp.effective_from,
              pp.effective_to,
              p.code AS product_code,
              p.name AS product_name
            FROM core.product_price pp
            JOIN core.product p ON p.id = pp.product_id
            WHERE pp.outlet_id = ?
              AND pp.effective_from <= ?
              AND (pp.effective_to IS NULL OR pp.effective_to >= ?)
              AND p.deleted_at IS NULL
          """
      );
      List<Object> params = new ArrayList<>();
      params.add(outletId);
      params.add(java.sql.Date.valueOf(onDate));
      params.add(java.sql.Date.valueOf(onDate));

      if (productId != null) {
        sql.append(" AND pp.product_id = ?");
        params.add(productId);
      }
      sql.append(" ORDER BY pp.product_id, pp.effective_from DESC )");

      sql.append(
          """
           SELECT
             product_id,
             outlet_id,
             currency_code,
             price_value,
             effective_from,
             effective_to,
             product_code,
             product_name,
             COUNT(*) OVER() AS total_count
           FROM current_prices
           WHERE 1 = 1
          """
      );
      if (q != null && !q.isBlank()) {
        sql.append(" AND (product_code ILIKE ? OR product_name ILIKE ?)");
        String pattern = "%" + q + "%";
        params.add(pattern);
        params.add(pattern);
      }
      sql.append(" ORDER BY ").append(resolvePriceSortClause(sortBy, sortDir)).append(" LIMIT ? OFFSET ?");
      params.add(limit);
      params.add(offset);

      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bind(ps, params);
        try (ResultSet rs = ps.executeQuery()) {
          List<ProductDtos.PriceView> rows = new ArrayList<>();
          long totalCount = 0;
          while (rs.next()) {
            totalCount = rs.getLong("total_count");
            rows.add(mapPrice(rs));
          }
          return PagedResult.of(rows, limit, offset, totalCount);
        }
      }
    });
  }

  public ProductDtos.PriceView upsertPrice(ProductDtos.UpsertPriceRequest request, Long actorUserId) {
    return executeInTransaction(conn -> {
      Instant now = clock.instant();
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.product_price (
            product_id, outlet_id, currency_code, price_value, effective_from, effective_to,
            created_by_user_id, updated_by_user_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (product_id, outlet_id, effective_from)
          DO UPDATE SET
            currency_code = EXCLUDED.currency_code,
            price_value = EXCLUDED.price_value,
            effective_to = EXCLUDED.effective_to,
            updated_by_user_id = EXCLUDED.updated_by_user_id,
            updated_at = EXCLUDED.updated_at
          """
      )) {
        ps.setLong(1, request.productId());
        ps.setLong(2, request.outletId());
        ps.setString(3, request.currencyCode().trim());
        ps.setBigDecimal(4, request.priceValue());
        ps.setObject(5, request.effectiveFrom());
        ps.setObject(6, request.effectiveTo());
        if (actorUserId == null) {
          ps.setNull(7, java.sql.Types.BIGINT);
          ps.setNull(8, java.sql.Types.BIGINT);
        } else {
          ps.setLong(7, actorUserId);
          ps.setLong(8, actorUserId);
        }
        ps.setTimestamp(9, Timestamp.from(now));
        ps.setTimestamp(10, Timestamp.from(now));
        ps.executeUpdate();
      }
      return findPriceTransactional(conn, request.productId(), request.outletId(), request.effectiveFrom())
          .orElseThrow(() -> new IllegalStateException("Saved price not found"));
    });
  }

  public Optional<ProductDtos.RecipeView> findRecipe(long productId, String version) {
    if (version != null && !version.isBlank()) {
      return findRecipeVersion(productId, version);
    }
    List<ProductDtos.RecipeView> versions = queryList(
        """
        SELECT product_id, version, yield_qty, yield_uom_code, status
        FROM core.recipe
        WHERE product_id = ?
        ORDER BY created_at DESC
        LIMIT 1
        """,
        rs -> mapRecipeHeader(rs, loadRecipeLines(productId, getString(rs, "version"))),
        productId
    );
    return versions.stream().findFirst();
  }

  public ProductDtos.RecipeView upsertRecipe(
      long productId,
      ProductDtos.UpsertRecipeRequest request,
      Long actorUserId
  ) {
    return executeInTransaction(conn -> {
      Instant now = clock.instant();
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.recipe (
            product_id, version, yield_qty, yield_uom_code, status, created_by_user_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?::recipe_status_enum, ?, ?, ?)
          ON CONFLICT (product_id, version)
          DO UPDATE SET
            yield_qty = EXCLUDED.yield_qty,
            yield_uom_code = EXCLUDED.yield_uom_code,
            status = EXCLUDED.status,
            updated_at = EXCLUDED.updated_at
          """
      )) {
        ps.setLong(1, productId);
        ps.setString(2, request.version().trim());
        ps.setBigDecimal(3, request.yieldQty());
        ps.setString(4, request.yieldUomCode().trim());
        ps.setString(5, normalizeRecipeStatus(request.status()));
        if (actorUserId == null) {
          ps.setNull(6, java.sql.Types.BIGINT);
        } else {
          ps.setLong(6, actorUserId);
        }
        ps.setTimestamp(7, Timestamp.from(now));
        ps.setTimestamp(8, Timestamp.from(now));
        ps.executeUpdate();
      }
      try (PreparedStatement delete = conn.prepareStatement(
          "DELETE FROM core.recipe_item WHERE product_id = ? AND version = ?"
      )) {
        delete.setLong(1, productId);
        delete.setString(2, request.version().trim());
        delete.executeUpdate();
      }
      for (ProductDtos.RecipeLineRequest line : request.items()) {
        try (PreparedStatement ps = conn.prepareStatement(
            """
            INSERT INTO core.recipe_item (
              product_id, version, item_id, uom_code, qty, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """
        )) {
          ps.setLong(1, productId);
          ps.setString(2, request.version().trim());
          ps.setLong(3, line.itemId());
          ps.setString(4, line.uomCode().trim());
          ps.setBigDecimal(5, line.qty());
          ps.setTimestamp(6, Timestamp.from(now));
          ps.setTimestamp(7, Timestamp.from(now));
          ps.executeUpdate();
        }
      }
      return findRecipeVersionTransactional(conn, productId, request.version().trim())
          .orElseThrow(() -> new IllegalStateException("Saved recipe not found"));
    });
  }

  private Optional<ProductDtos.RecipeView> findRecipeVersion(long productId, String version) {
    List<ProductDtos.RecipeView> recipes = queryList(
        """
        SELECT product_id, version, yield_qty, yield_uom_code, status
        FROM core.recipe
        WHERE product_id = ? AND version = ?
        """,
        rs -> mapRecipeHeader(rs, loadRecipeLines(productId, version)),
        productId,
        version
    );
    return recipes.stream().findFirst();
  }

  private Optional<ProductDtos.ProductView> findProductById(Connection conn, long productId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT id, code, name, category_code, status, image_url, description
        FROM core.product
        WHERE id = ? AND deleted_at IS NULL
        """
    )) {
      ps.setLong(1, productId);
      try (ResultSet rs = ps.executeQuery()) {
        if (rs.next()) {
          return Optional.of(mapProduct(rs));
        }
        return Optional.empty();
      }
    }
  }

  private Optional<ProductDtos.ItemView> findItemById(Connection conn, long itemId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT id, code, name, category_code, base_uom_code, min_stock_level, max_stock_level, status
        FROM core.item
        WHERE id = ? AND deleted_at IS NULL
        """
    )) {
      ps.setLong(1, itemId);
      try (ResultSet rs = ps.executeQuery()) {
        if (rs.next()) {
          return Optional.of(mapItem(rs));
        }
        return Optional.empty();
      }
    }
  }

  private Optional<ProductDtos.PriceView> findPriceTransactional(
      Connection conn,
      long productId,
      long outletId,
      LocalDate onDate
  ) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT product_id, outlet_id, currency_code, price_value, effective_from, effective_to
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
      ps.setObject(3, onDate);
      ps.setObject(4, onDate);
      try (ResultSet rs = ps.executeQuery()) {
        if (rs.next()) {
          return Optional.of(mapPrice(rs));
        }
        return Optional.empty();
      }
    }
  }

  private Optional<ProductDtos.RecipeView> findRecipeVersionTransactional(
      Connection conn,
      long productId,
      String version
  ) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT product_id, version, yield_qty, yield_uom_code, status
        FROM core.recipe
        WHERE product_id = ? AND version = ?
        """
    )) {
      ps.setLong(1, productId);
      ps.setString(2, version);
      try (ResultSet rs = ps.executeQuery()) {
        if (rs.next()) {
          return Optional.of(mapRecipeHeader(rs, loadRecipeLinesTransactional(conn, productId, version)));
        }
        return Optional.empty();
      }
    }
  }

  private List<ProductDtos.RecipeLineView> loadRecipeLines(long productId, String version) {
    return queryList(
        """
        SELECT item_id, uom_code, qty
        FROM core.recipe_item
        WHERE product_id = ? AND version = ?
        ORDER BY item_id
        """,
        this::mapRecipeLine,
        productId,
        version
    );
  }

  private List<ProductDtos.RecipeLineView> loadRecipeLinesTransactional(
      Connection conn,
      long productId,
      String version
  ) throws Exception {
    List<ProductDtos.RecipeLineView> items = new ArrayList<>();
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT item_id, uom_code, qty
        FROM core.recipe_item
        WHERE product_id = ? AND version = ?
        ORDER BY item_id
        """
    )) {
      ps.setLong(1, productId);
      ps.setString(2, version);
      try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
          items.add(mapRecipeLine(rs));
        }
      }
    }
    return List.copyOf(items);
  }

  private String resolveProductSortClause(String sortBy, String sortDir) {
    String key = QueryConventions.normalizeSortBy(sortBy, PRODUCT_SORT_KEYS, "code");
    String direction = normalizeSortDir(sortDir, "code".equals(key) ? "asc" : "desc");
    return switch (key) {
      case "code" -> "code " + direction + ", id ASC";
      case "name" -> "name " + direction + ", id ASC";
      case "categoryCode" -> "category_code " + direction + " NULLS LAST, code ASC, id ASC";
      case "status" -> "status " + direction + ", code ASC, id ASC";
      case "updatedAt" -> "updated_at " + direction + ", id DESC";
      default -> throw ServiceException.badRequest("Unsupported sortBy for /product/products");
    };
  }

  private String resolveItemSortClause(String sortBy, String sortDir) {
    String key = QueryConventions.normalizeSortBy(sortBy, ITEM_SORT_KEYS, "code");
    String direction = normalizeSortDir(sortDir, "code".equals(key) ? "asc" : "desc");
    return switch (key) {
      case "code" -> "code " + direction + ", id ASC";
      case "name" -> "name " + direction + ", id ASC";
      case "categoryCode" -> "category_code " + direction + " NULLS LAST, code ASC, id ASC";
      case "status" -> "status " + direction + ", code ASC, id ASC";
      case "updatedAt" -> "updated_at " + direction + ", id DESC";
      default -> throw ServiceException.badRequest("Unsupported sortBy for /product/items");
    };
  }

  private String resolvePriceSortClause(String sortBy, String sortDir) {
    String key = QueryConventions.normalizeSortBy(sortBy, PRICE_SORT_KEYS, "effectiveFrom");
    String direction = normalizeSortDir(sortDir, "effectiveFrom".equals(key) ? "desc" : "asc");
    return switch (key) {
      case "productCode" -> "product_code " + direction + ", product_id ASC";
      case "productName" -> "product_name " + direction + ", product_id ASC";
      case "priceValue" -> "price_value " + direction + ", product_id ASC";
      case "effectiveFrom" -> "effective_from " + direction + ", product_id ASC";
      default -> throw ServiceException.badRequest("Unsupported sortBy for /product/prices");
    };
  }

  private String normalizeSortDir(String sortDir, String defaultDirection) {
    if (sortDir == null || sortDir.isBlank()) {
      return defaultDirection;
    }
    return QueryConventions.normalizeSortDir(sortDir);
  }

  private void bind(PreparedStatement ps, List<Object> params) throws java.sql.SQLException {
    for (int i = 0; i < params.size(); i++) {
      ps.setObject(i + 1, params.get(i));
    }
  }

  private ProductDtos.ProductView mapProduct(ResultSet rs) {
    try {
      return new ProductDtos.ProductView(
          rs.getLong("id"),
          rs.getString("code"),
          rs.getString("name"),
          rs.getString("category_code"),
          rs.getString("status"),
          rs.getString("image_url"),
          rs.getString("description")
      );
    } catch (Exception e) {
      throw new IllegalStateException("Unable to map product", e);
    }
  }

  private ProductDtos.ItemView mapItem(ResultSet rs) {
    try {
      return new ProductDtos.ItemView(
          rs.getLong("id"),
          rs.getString("code"),
          rs.getString("name"),
          rs.getString("category_code"),
          rs.getString("base_uom_code"),
          rs.getBigDecimal("min_stock_level"),
          rs.getBigDecimal("max_stock_level"),
          rs.getString("status")
      );
    } catch (Exception e) {
      throw new IllegalStateException("Unable to map item", e);
    }
  }

  private ProductDtos.PriceView mapPrice(ResultSet rs) {
    try {
      return new ProductDtos.PriceView(
          rs.getLong("product_id"),
          rs.getLong("outlet_id"),
          rs.getString("currency_code"),
          rs.getBigDecimal("price_value"),
          rs.getObject("effective_from", LocalDate.class),
          rs.getObject("effective_to", LocalDate.class)
      );
    } catch (Exception e) {
      throw new IllegalStateException("Unable to map price", e);
    }
  }

  private ProductDtos.RecipeView mapRecipeHeader(ResultSet rs, List<ProductDtos.RecipeLineView> items) {
    try {
      return new ProductDtos.RecipeView(
          rs.getLong("product_id"),
          rs.getString("version"),
          rs.getBigDecimal("yield_qty"),
          rs.getString("yield_uom_code"),
          rs.getString("status"),
          items
      );
    } catch (Exception e) {
      throw new IllegalStateException("Unable to map recipe", e);
    }
  }

  private ProductDtos.RecipeLineView mapRecipeLine(ResultSet rs) {
    try {
      return new ProductDtos.RecipeLineView(
          rs.getLong("item_id"),
          rs.getString("uom_code"),
          rs.getBigDecimal("qty")
      );
    } catch (Exception e) {
      throw new IllegalStateException("Unable to map recipe line", e);
    }
  }

  private static String getString(ResultSet rs, String column) {
    try {
      return rs.getString(column);
    } catch (Exception e) {
      throw new IllegalStateException("Unable to read column " + column, e);
    }
  }

  private static String normalizeRecipeStatus(String status) {
    if (status == null || status.isBlank()) {
      return "draft";
    }
    return status.trim();
  }

  private static String trimToNull(String value) {
    if (value == null) {
      return null;
    }
    String trimmed = value.trim();
    return trimmed.isEmpty() ? null : trimmed;
  }
}
