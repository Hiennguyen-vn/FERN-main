package com.fern.services.product.infrastructure;

import com.dorabets.common.repository.BaseRepository;
import com.fern.services.product.api.ProductDtos;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import java.sql.Array;
import java.sql.Connection;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import javax.sql.DataSource;
import org.springframework.stereotype.Repository;

@Repository
public class MenuRepository extends BaseRepository {

  private final SnowflakeIdGenerator snowflakeIdGenerator;

  public MenuRepository(DataSource dataSource, SnowflakeIdGenerator snowflakeIdGenerator) {
    super(dataSource);
    this.snowflakeIdGenerator = snowflakeIdGenerator;
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
    return listMenus().stream().filter(m -> m.id() == menuId).findFirst();
  }

  public ProductDtos.MenuView createMenu(ProductDtos.CreateMenuRequest request) {
    long id = snowflakeIdGenerator.generateId();
    execute(
        """
        INSERT INTO core.menu (id, code, name, description, scope_type, scope_id)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        id,
        request.code().trim(),
        request.name().trim(),
        request.description(),
        request.scopeType() != null ? request.scopeType() : "corporate",
        request.scopeId()
    );
    return findMenu(id).orElseThrow();
  }

  public ProductDtos.MenuView updateMenu(long menuId, ProductDtos.UpdateMenuRequest request) {
    StringBuilder sb = new StringBuilder("UPDATE core.menu SET updated_at = now()");
    List<Object> params = new ArrayList<>();
    if (request.name() != null) { sb.append(", name = ?"); params.add(request.name().trim()); }
    if (request.description() != null) { sb.append(", description = ?"); params.add(request.description()); }
    if (request.status() != null) { sb.append(", status = ?"); params.add(request.status()); }
    sb.append(" WHERE id = ? AND deleted_at IS NULL");
    params.add(menuId);
    execute(sb.toString(), params.toArray());
    return findMenu(menuId).orElseThrow();
  }

  // ── Categories ────────────────────────────────────────

  public ProductDtos.MenuCategoryView addCategory(long menuId, ProductDtos.AddMenuCategoryRequest request) {
    long id = snowflakeIdGenerator.generateId();
    execute(
        """
        INSERT INTO core.menu_category (id, menu_id, code, name, display_order)
        VALUES (?, ?, ?, ?, ?)
        """,
        id, menuId, request.code().trim(), request.name().trim(), request.displayOrder()
    );
    return new ProductDtos.MenuCategoryView(id, request.code().trim(), request.name().trim(), request.displayOrder(), List.of());
  }

  // ── Items ─────────────────────────────────────────────

  public ProductDtos.MenuItemView addItem(long categoryId, ProductDtos.AddMenuItemRequest request) {
    long id = snowflakeIdGenerator.generateId();
    execute(
        """
        INSERT INTO core.menu_item (id, menu_category_id, product_id, display_order)
        VALUES (?, ?, ?, ?)
        """,
        id, categoryId, request.productId(), request.displayOrder()
    );
    return queryOne(
        """
        SELECT mi.id, mi.product_id, p.code AS product_code, p.name AS product_name,
               p.status AS product_status, mi.display_order, mi.is_active
        FROM core.menu_item mi
        JOIN core.product p ON p.id = mi.product_id
        WHERE mi.id = ?
        """,
        rs -> {
          try {
            return new ProductDtos.MenuItemView(
                rs.getLong("id"), rs.getLong("product_id"), rs.getString("product_code"),
                rs.getString("product_name"), rs.getString("product_status"),
                rs.getInt("display_order"), rs.getBoolean("is_active")
            );
          } catch (Exception e) { throw new IllegalStateException("map item", e); }
        },
        id
    ).orElseThrow();
  }

  public void removeItem(long itemId) {
    execute("DELETE FROM core.menu_item_exclusion WHERE menu_item_id = ?", itemId);
    execute("DELETE FROM core.menu_item WHERE id = ?", itemId);
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
    Map<Long, List<CatRow>> result = new LinkedHashMap<>();
    for (Long menuId : menuIds) {
      queryList(
          """
          SELECT mc.id, mc.menu_id, mc.code, mc.name, mc.display_order
          FROM core.menu_category mc
          WHERE mc.menu_id = ?
          ORDER BY mc.display_order, mc.name
          """,
          rs -> {
            try {
              return new CatRow(rs.getLong("id"), rs.getLong("menu_id"), rs.getString("code"),
                  rs.getString("name"), rs.getInt("display_order"));
            } catch (Exception e) { throw new IllegalStateException("map cat", e); }
          },
          menuId
      ).forEach(c -> result.computeIfAbsent(c.menuId(), k -> new ArrayList<>()).add(c));
    }
    return result;
  }

  private Map<Long, List<ItemRow>> loadItems(List<Long> menuIds) {
    Map<Long, List<ItemRow>> result = new LinkedHashMap<>();
    for (Long menuId : menuIds) {
      queryList(
          """
          SELECT mi.id, mi.menu_category_id, mi.product_id, p.code AS product_code, p.name AS product_name,
                 p.status AS product_status, mi.display_order, mi.is_active
          FROM core.menu_item mi
          JOIN core.menu_category mc ON mc.id = mi.menu_category_id
          JOIN core.product p ON p.id = mi.product_id
          WHERE mc.menu_id = ?
          ORDER BY mi.display_order, p.name
          """,
          rs -> {
            try {
              return new ItemRow(rs.getLong("id"), rs.getLong("menu_category_id"),
                  rs.getLong("product_id"), rs.getString("product_code"), rs.getString("product_name"),
                  rs.getString("product_status"), rs.getInt("display_order"), rs.getBoolean("is_active"));
            } catch (Exception e) { throw new IllegalStateException("map item row", e); }
          },
          menuId
      ).forEach(i -> result.computeIfAbsent(i.categoryId(), k -> new ArrayList<>()).add(i));
    }
    return result;
  }

  private record MenuRow(long id, String code, String name, String description, String status, String scopeType, Long scopeId) {}
  private record CatRow(long id, long menuId, String code, String name, int displayOrder) {}
  private record ItemRow(long id, long categoryId, long productId, String productCode, String productName, String productStatus, int displayOrder, boolean isActive) {}
}
