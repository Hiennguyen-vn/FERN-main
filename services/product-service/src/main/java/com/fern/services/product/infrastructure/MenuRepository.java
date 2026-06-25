package com.fern.services.product.infrastructure;

import com.fern.common.repository.BaseRepository;
import com.fern.common.sync.CentralSyncOutboxWriter;
import com.fern.common.sync.SyncPayloadSchemas;
import com.fern.services.product.api.ProductDtos;
import com.fern.common.utils.services.id.SnowflakeIdGenerator;
import java.sql.Array;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.Optional;
import javax.sql.DataSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Repository;

@Repository
public class MenuRepository extends BaseRepository {

  private final SnowflakeIdGenerator snowflakeIdGenerator;
  private final CentralSyncOutboxWriter centralSyncOutboxWriter;
  private final Clock clock;

  @Autowired
  public MenuRepository(
      DataSource dataSource,
      SnowflakeIdGenerator snowflakeIdGenerator,
      CentralSyncOutboxWriter centralSyncOutboxWriter,
      Clock clock
  ) {
    super(dataSource);
    this.snowflakeIdGenerator = snowflakeIdGenerator;
    this.centralSyncOutboxWriter = centralSyncOutboxWriter;
    this.clock = clock;
  }

  public MenuRepository(DataSource dataSource, SnowflakeIdGenerator snowflakeIdGenerator) {
    this(dataSource, snowflakeIdGenerator, null, Clock.systemUTC());
  }

  // ── Menu CRUD ─────────────────────────────────────────

  public List<ProductDtos.MenuView> listMenus() {
    List<MenuRow> menuRows = queryList(
        """
        SELECT m.id, m.code, m.name, m.description, m.status, m.scope_type, m.scope_id
        FROM core.menu m
        WHERE m.deleted_at IS NULL
        ORDER BY m.name
        """,
        rs -> {
          try {
            return new MenuRow(rs.getLong("id"), rs.getString("code"), rs.getString("name"),
                rs.getString("description"), rs.getString("status"), rs.getString("scope_type"),
                rs.getObject("scope_id") != null ? rs.getLong("scope_id") : null);
          } catch (Exception e) { throw new IllegalStateException("map menu", e); }
        }
    );

    if (menuRows.isEmpty()) {
      return List.of();
    }

    List<Long> menuIds = menuRows.stream().map(MenuRow::id).toList();
    Map<Long, List<CatRow>> catsByMenu = loadCategories(menuIds);
    Map<Long, List<ItemRow>> itemsByCat = loadItems(menuIds);

    return menuRows.stream().map(m -> {
      List<CatRow> cats = catsByMenu.getOrDefault(m.id(), List.of());
      List<ProductDtos.MenuCategoryView> catViews = cats.stream().map(c -> {
        List<ItemRow> items = itemsByCat.getOrDefault(c.id(), List.of());
        return new ProductDtos.MenuCategoryView(
            c.id(), c.code(), c.name(), c.displayOrder(),
            items.stream().map(i -> new ProductDtos.MenuItemView(
                i.id(), i.productId(), i.productCode(), i.productName(), i.productStatus(),
                i.displayOrder(), i.isActive()
            )).toList()
        );
      }).toList();
      return new ProductDtos.MenuView(m.id(), m.code(), m.name(), m.description(), m.status(), m.scopeType(), m.scopeId(), catViews);
    }).toList();
  }

  public Optional<ProductDtos.MenuView> findMenu(long menuId) {
    List<MenuRow> menuRows = queryList(
        """
        SELECT m.id, m.code, m.name, m.description, m.status, m.scope_type, m.scope_id
        FROM core.menu m
        WHERE m.id = ? AND m.deleted_at IS NULL
        """,
        rs -> {
          try {
            return new MenuRow(rs.getLong("id"), rs.getString("code"), rs.getString("name"),
                rs.getString("description"), rs.getString("status"), rs.getString("scope_type"),
                rs.getObject("scope_id") != null ? rs.getLong("scope_id") : null);
          } catch (Exception e) { throw new IllegalStateException("map menu", e); }
        },
        menuId
    );
    if (menuRows.isEmpty()) {
      return Optional.empty();
    }
    MenuRow m = menuRows.get(0);
    List<Long> ids = List.of(m.id());
    Map<Long, List<CatRow>> catsByMenu = loadCategories(ids);
    Map<Long, List<ItemRow>> itemsByCat = loadItems(ids);
    List<ProductDtos.MenuCategoryView> catViews = catsByMenu.getOrDefault(m.id(), List.of()).stream()
        .map(c -> new ProductDtos.MenuCategoryView(
            c.id(), c.code(), c.name(), c.displayOrder(),
            itemsByCat.getOrDefault(c.id(), List.of()).stream().map(i -> new ProductDtos.MenuItemView(
                i.id(), i.productId(), i.productCode(), i.productName(), i.productStatus(),
                i.displayOrder(), i.isActive()
            )).toList()
        ))
        .toList();
    return Optional.of(new ProductDtos.MenuView(
        m.id(), m.code(), m.name(), m.description(), m.status(), m.scopeType(), m.scopeId(), catViews));
  }

  public ProductDtos.MenuView createMenu(ProductDtos.CreateMenuRequest request) {
    return executeInTransaction(conn -> {
      long id = snowflakeIdGenerator.generateId();
      Instant now = clock.instant();
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.menu (id, code, name, description, scope_type, scope_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          """
      )) {
        ps.setLong(1, id);
        ps.setString(2, request.code().trim());
        ps.setString(3, request.name().trim());
        ps.setString(4, request.description());
        ps.setString(5, request.scopeType() != null ? request.scopeType() : "corporate");
        if (request.scopeId() == null) {
          ps.setNull(6, java.sql.Types.BIGINT);
        } else {
          ps.setLong(6, request.scopeId());
        }
        ps.setTimestamp(7, Timestamp.from(now));
        ps.setTimestamp(8, Timestamp.from(now));
        ps.executeUpdate();
      }
      ProductDtos.MenuView menu = findMenuTransactional(conn, id).orElseThrow();
      appendMenuSyncEvent(conn, "MENU_UPDATED", menu, now);
      return menu;
    });
  }

  public ProductDtos.MenuView updateMenu(long menuId, ProductDtos.UpdateMenuRequest request) {
    return executeInTransaction(conn -> {
      Instant now = clock.instant();
      StringBuilder sb = new StringBuilder("UPDATE core.menu SET updated_at = ?");
      List<Object> params = new ArrayList<>();
      params.add(Timestamp.from(now));
      if (request.name() != null) { sb.append(", name = ?"); params.add(request.name().trim()); }
      if (request.description() != null) { sb.append(", description = ?"); params.add(request.description()); }
      if (request.status() != null) { sb.append(", status = ?"); params.add(request.status()); }
      sb.append(" WHERE id = ? AND deleted_at IS NULL");
      params.add(menuId);
      try (PreparedStatement ps = conn.prepareStatement(sb.toString())) {
        bind(ps, params);
        ps.executeUpdate();
      }
      ProductDtos.MenuView menu = findMenuTransactional(conn, menuId).orElseThrow();
      appendMenuSyncEvent(conn, "MENU_UPDATED", menu, now);
      return menu;
    });
  }

  // ── Categories ────────────────────────────────────────

  public ProductDtos.MenuCategoryView addCategory(long menuId, ProductDtos.AddMenuCategoryRequest request) {
    return executeInTransaction(conn -> {
      long id = snowflakeIdGenerator.generateId();
      Instant now = clock.instant();
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.menu_category (id, menu_id, code, name, display_order, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
          """
      )) {
        ps.setLong(1, id);
        ps.setLong(2, menuId);
        ps.setString(3, request.code().trim());
        ps.setString(4, request.name().trim());
        ps.setInt(5, request.displayOrder());
        ps.setTimestamp(6, Timestamp.from(now));
        ps.executeUpdate();
      }
      ProductDtos.MenuView menu = findMenuTransactional(conn, menuId).orElseThrow();
      appendMenuSyncEvent(conn, "MENU_UPDATED", menu, now);
      return new ProductDtos.MenuCategoryView(id, request.code().trim(), request.name().trim(), request.displayOrder(), List.of());
    });
  }

  // ── Items ─────────────────────────────────────────────

  public ProductDtos.MenuItemView addItem(long categoryId, ProductDtos.AddMenuItemRequest request) {
    return executeInTransaction(conn -> {
      long id = snowflakeIdGenerator.generateId();
      Instant now = clock.instant();
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.menu_item (id, menu_category_id, product_id, display_order, created_at)
          VALUES (?, ?, ?, ?, ?)
          """
      )) {
        ps.setLong(1, id);
        ps.setLong(2, categoryId);
        ps.setLong(3, request.productId());
        ps.setInt(4, request.displayOrder());
        ps.setTimestamp(5, Timestamp.from(now));
        ps.executeUpdate();
      }
      ProductDtos.MenuItemView item = findMenuItemTransactional(conn, id).orElseThrow();
      Long menuId = findMenuIdForCategory(conn, categoryId).orElseThrow();
      ProductDtos.MenuView menu = findMenuTransactional(conn, menuId).orElseThrow();
      appendMenuSyncEvent(conn, "MENU_UPDATED", menu, now);
      return item;
    });
  }

  public void removeItem(long itemId) {
    executeInTransaction(conn -> {
      Instant now = clock.instant();
      Long menuId = findMenuIdForItem(conn, itemId).orElse(null);
      try (PreparedStatement ps = conn.prepareStatement("DELETE FROM core.menu_item_exclusion WHERE menu_item_id = ?")) {
        ps.setLong(1, itemId);
        ps.executeUpdate();
      }
      try (PreparedStatement ps = conn.prepareStatement("DELETE FROM core.menu_item WHERE id = ?")) {
        ps.setLong(1, itemId);
        ps.executeUpdate();
      }
      if (menuId != null) {
        ProductDtos.MenuView menu = findMenuTransactional(conn, menuId).orElseThrow();
        appendMenuSyncEvent(conn, "MENU_UPDATED", menu, now);
      }
      return null;
    });
  }

  // ── Exclusions ────────────────────────────────────────

  public List<ProductDtos.MenuItemExclusionView> listExclusions(long menuId) {
    return queryList(
        """
        SELECT mie.menu_item_id, mie.outlet_id, mie.reason
        FROM core.menu_item_exclusion mie
        JOIN core.menu_item mi ON mi.id = mie.menu_item_id
        JOIN core.menu_category mc ON mc.id = mi.menu_category_id
        WHERE mc.menu_id = ?
        """,
        rs -> {
          try {
            return new ProductDtos.MenuItemExclusionView(
                rs.getLong("menu_item_id"), rs.getLong("outlet_id"), rs.getString("reason")
            );
          } catch (Exception e) { throw new IllegalStateException("map exclusion", e); }
        },
        menuId
    );
  }

  public void setExclusion(ProductDtos.SetMenuItemExclusionRequest request) {
    execute(
        """
        INSERT INTO core.menu_item_exclusion (menu_item_id, outlet_id, reason)
        VALUES (?, ?, ?)
        ON CONFLICT (menu_item_id, outlet_id) DO UPDATE SET reason = EXCLUDED.reason
        """,
        request.menuItemId(), request.outletId(), request.reason()
    );
  }

  public void removeExclusion(long menuItemId, long outletId) {
    execute("DELETE FROM core.menu_item_exclusion WHERE menu_item_id = ? AND outlet_id = ?", menuItemId, outletId);
  }

  // ── Channel & Daypart ─────────────────────────────────

  public List<ProductDtos.ChannelView> listChannels() {
    return queryList(
        "SELECT code, name, is_active, display_order FROM core.channel ORDER BY display_order",
        rs -> {
          try {
            return new ProductDtos.ChannelView(rs.getString("code"), rs.getString("name"),
                rs.getBoolean("is_active"), rs.getInt("display_order"));
          } catch (Exception e) { throw new IllegalStateException("map channel", e); }
        }
    );
  }

  public List<ProductDtos.DaypartView> listDayparts() {
    return queryList(
        "SELECT code, name, start_time, end_time, is_active, display_order FROM core.daypart ORDER BY display_order",
        rs -> {
          try {
            return new ProductDtos.DaypartView(
                rs.getString("code"), rs.getString("name"),
                rs.getString("start_time"), rs.getString("end_time"),
                rs.getBoolean("is_active"), rs.getInt("display_order")
            );
          } catch (Exception e) { throw new IllegalStateException("map daypart", e); }
        }
    );
  }

  // ── Helpers ───────────────────────────────────────────

  private Map<Long, List<CatRow>> loadCategories(List<Long> menuIds) {
    if (menuIds.isEmpty()) {
      return new LinkedHashMap<>();
    }
    String placeholders = menuIds.stream().map(id -> "?").collect(Collectors.joining(","));
    Map<Long, List<CatRow>> result = new LinkedHashMap<>();
    queryList(
        """
        SELECT mc.id, mc.menu_id, mc.code, mc.name, mc.display_order
        FROM core.menu_category mc
        WHERE mc.menu_id IN (%s)
        ORDER BY mc.menu_id, mc.display_order, mc.name
        """.formatted(placeholders),
        rs -> {
          try {
            return new CatRow(rs.getLong("id"), rs.getLong("menu_id"), rs.getString("code"),
                rs.getString("name"), rs.getInt("display_order"));
          } catch (Exception e) { throw new IllegalStateException("map cat", e); }
        },
        menuIds.toArray()
    ).forEach(c -> result.computeIfAbsent(c.menuId(), k -> new ArrayList<>()).add(c));
    return result;
  }

  private Map<Long, List<ItemRow>> loadItems(List<Long> menuIds) {
    if (menuIds.isEmpty()) {
      return new LinkedHashMap<>();
    }
    String placeholders = menuIds.stream().map(id -> "?").collect(Collectors.joining(","));
    Map<Long, List<ItemRow>> result = new LinkedHashMap<>();
    queryList(
        """
        SELECT mi.id, mi.menu_category_id, mi.product_id, p.code AS product_code, p.name AS product_name,
               p.status AS product_status, mi.display_order, mi.is_active
        FROM core.menu_item mi
        JOIN core.menu_category mc ON mc.id = mi.menu_category_id
        JOIN core.product p ON p.id = mi.product_id
        WHERE mc.menu_id IN (%s)
        ORDER BY mi.display_order, p.name
        """.formatted(placeholders),
        rs -> {
          try {
            return new ItemRow(rs.getLong("id"), rs.getLong("menu_category_id"),
                rs.getLong("product_id"), rs.getString("product_code"), rs.getString("product_name"),
                rs.getString("product_status"), rs.getInt("display_order"), rs.getBoolean("is_active"));
          } catch (Exception e) { throw new IllegalStateException("map item row", e); }
        },
        menuIds.toArray()
    ).forEach(i -> result.computeIfAbsent(i.categoryId(), k -> new ArrayList<>()).add(i));
    return result;
  }

  private Optional<ProductDtos.MenuView> findMenuTransactional(Connection conn, long menuId) throws Exception {
    MenuRow row;
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT m.id, m.code, m.name, m.description, m.status, m.scope_type, m.scope_id
        FROM core.menu m
        WHERE m.id = ? AND m.deleted_at IS NULL
        """
    )) {
      ps.setLong(1, menuId);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) {
          return Optional.empty();
        }
        row = new MenuRow(
            rs.getLong("id"),
            rs.getString("code"),
            rs.getString("name"),
            rs.getString("description"),
            rs.getString("status"),
            rs.getString("scope_type"),
            rs.getObject("scope_id") != null ? rs.getLong("scope_id") : null
        );
      }
    }
    Map<Long, List<CatRow>> catsByMenu = loadCategoriesTransactional(conn, List.of(menuId));
    Map<Long, List<ItemRow>> itemsByCat = loadItemsTransactional(conn, List.of(menuId));
    List<ProductDtos.MenuCategoryView> categories = catsByMenu.getOrDefault(row.id(), List.of()).stream()
        .map(c -> new ProductDtos.MenuCategoryView(
            c.id(),
            c.code(),
            c.name(),
            c.displayOrder(),
            itemsByCat.getOrDefault(c.id(), List.of()).stream()
                .map(i -> new ProductDtos.MenuItemView(
                    i.id(), i.productId(), i.productCode(), i.productName(), i.productStatus(),
                    i.displayOrder(), i.isActive()))
                .toList()
        ))
        .toList();
    return Optional.of(new ProductDtos.MenuView(
        row.id(), row.code(), row.name(), row.description(), row.status(), row.scopeType(), row.scopeId(), categories));
  }

  private Optional<ProductDtos.MenuItemView> findMenuItemTransactional(Connection conn, long itemId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT mi.id, mi.product_id, p.code AS product_code, p.name AS product_name,
               p.status AS product_status, mi.display_order, mi.is_active
        FROM core.menu_item mi
        JOIN core.product p ON p.id = mi.product_id
        WHERE mi.id = ?
        """
    )) {
      ps.setLong(1, itemId);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) {
          return Optional.empty();
        }
        return Optional.of(new ProductDtos.MenuItemView(
            rs.getLong("id"),
            rs.getLong("product_id"),
            rs.getString("product_code"),
            rs.getString("product_name"),
            rs.getString("product_status"),
            rs.getInt("display_order"),
            rs.getBoolean("is_active")
        ));
      }
    }
  }

  private Optional<Long> findMenuIdForCategory(Connection conn, long categoryId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement("SELECT menu_id FROM core.menu_category WHERE id = ?")) {
      ps.setLong(1, categoryId);
      try (ResultSet rs = ps.executeQuery()) {
        return rs.next() ? Optional.of(rs.getLong(1)) : Optional.empty();
      }
    }
  }

  private Optional<Long> findMenuIdForItem(Connection conn, long itemId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT mc.menu_id
        FROM core.menu_item mi
        JOIN core.menu_category mc ON mc.id = mi.menu_category_id
        WHERE mi.id = ?
        """
    )) {
      ps.setLong(1, itemId);
      try (ResultSet rs = ps.executeQuery()) {
        return rs.next() ? Optional.of(rs.getLong(1)) : Optional.empty();
      }
    }
  }

  private Map<Long, List<CatRow>> loadCategoriesTransactional(Connection conn, List<Long> menuIds) throws Exception {
    if (menuIds.isEmpty()) {
      return new LinkedHashMap<>();
    }
    String placeholders = menuIds.stream().map(id -> "?").collect(Collectors.joining(","));
    Map<Long, List<CatRow>> result = new LinkedHashMap<>();
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT mc.id, mc.menu_id, mc.code, mc.name, mc.display_order
        FROM core.menu_category mc
        WHERE mc.menu_id IN (%s)
        ORDER BY mc.menu_id, mc.display_order, mc.name
        """.formatted(placeholders)
    )) {
      for (int i = 0; i < menuIds.size(); i++) {
        ps.setLong(i + 1, menuIds.get(i));
      }
      try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
          CatRow row = new CatRow(
              rs.getLong("id"),
              rs.getLong("menu_id"),
              rs.getString("code"),
              rs.getString("name"),
              rs.getInt("display_order"));
          result.computeIfAbsent(row.menuId(), k -> new ArrayList<>()).add(row);
        }
      }
    }
    return result;
  }

  private Map<Long, List<ItemRow>> loadItemsTransactional(Connection conn, List<Long> menuIds) throws Exception {
    if (menuIds.isEmpty()) {
      return new LinkedHashMap<>();
    }
    String placeholders = menuIds.stream().map(id -> "?").collect(Collectors.joining(","));
    Map<Long, List<ItemRow>> result = new LinkedHashMap<>();
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT mi.id, mi.menu_category_id, mi.product_id, p.code AS product_code, p.name AS product_name,
               p.status AS product_status, mi.display_order, mi.is_active
        FROM core.menu_item mi
        JOIN core.menu_category mc ON mc.id = mi.menu_category_id
        JOIN core.product p ON p.id = mi.product_id
        WHERE mc.menu_id IN (%s)
        ORDER BY mi.display_order, p.name
        """.formatted(placeholders)
    )) {
      for (int i = 0; i < menuIds.size(); i++) {
        ps.setLong(i + 1, menuIds.get(i));
      }
      try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
          ItemRow row = new ItemRow(
              rs.getLong("id"),
              rs.getLong("menu_category_id"),
              rs.getLong("product_id"),
              rs.getString("product_code"),
              rs.getString("product_name"),
              rs.getString("product_status"),
              rs.getInt("display_order"),
              rs.getBoolean("is_active"));
          result.computeIfAbsent(row.categoryId(), k -> new ArrayList<>()).add(row);
        }
      }
    }
    return result;
  }

  private void appendMenuSyncEvent(Connection conn, String eventType, ProductDtos.MenuView menu, Instant updatedAt) {
    if (centralSyncOutboxWriter == null) {
      return;
    }
    String aggregateId = Long.toString(menu.id());
    long version = centralSyncOutboxWriter.nextVersion(conn, "MENU", aggregateId);
    Long targetStoreId = "outlet".equalsIgnoreCase(menu.scopeType()) ? menu.scopeId() : null;
    centralSyncOutboxWriter.append(
        conn,
        eventType,
        "MENU",
        aggregateId,
        targetStoreId == null ? "ALL_STORES" : "STORE",
        targetStoreId,
        null,
        new SyncPayloadSchemas.MenuPayload(
            menu.id(),
            menu.code(),
            menu.name(),
            menu.description(),
            menu.status(),
            menu.scopeType(),
            menu.scopeId(),
            version,
            updatedAt,
            menu.categories().stream()
                .map(category -> new SyncPayloadSchemas.MenuCategoryPayload(
                    category.id(),
                    category.code(),
                    category.name(),
                    category.displayOrder(),
                    category.items().stream()
                        .map(item -> new SyncPayloadSchemas.MenuItemPayload(
                            item.id(),
                            item.productId(),
                            item.displayOrder(),
                            item.isActive()))
                        .toList()))
                .toList()
        ),
        version
    );
  }

  private void bind(PreparedStatement ps, List<Object> params) throws java.sql.SQLException {
    for (int i = 0; i < params.size(); i++) {
      ps.setObject(i + 1, params.get(i));
    }
  }

  private record MenuRow(long id, String code, String name, String description, String status, String scopeType, Long scopeId) {}
  private record CatRow(long id, long menuId, String code, String name, int displayOrder) {}
  private record ItemRow(long id, long categoryId, long productId, String productCode, String productName, String productStatus, int displayOrder, boolean isActive) {}
}
