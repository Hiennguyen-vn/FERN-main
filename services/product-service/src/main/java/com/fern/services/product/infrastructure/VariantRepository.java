package com.fern.services.product.infrastructure;

import com.dorabets.common.repository.BaseRepository;
import com.fern.services.product.api.ProductDtos;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import javax.sql.DataSource;
import org.springframework.stereotype.Repository;

@Repository
public class VariantRepository extends BaseRepository {

  private final SnowflakeIdGenerator snowflakeIdGenerator;

  public VariantRepository(DataSource dataSource, SnowflakeIdGenerator snowflakeIdGenerator) {
    super(dataSource);
    this.snowflakeIdGenerator = snowflakeIdGenerator;
  }

  public List<ProductDtos.VariantView> listVariants(long productId) {
    return queryList(
        "SELECT id, product_id, code, name, price_modifier_type, price_modifier_value, display_order, is_active FROM core.product_variant WHERE product_id = ? ORDER BY display_order",
        rs -> {
          try {
            return new ProductDtos.VariantView(rs.getLong("id"), rs.getLong("product_id"), rs.getString("code"), rs.getString("name"),
                rs.getString("price_modifier_type"), rs.getBigDecimal("price_modifier_value"), rs.getInt("display_order"), rs.getBoolean("is_active"));
          } catch (Exception e) { throw new IllegalStateException("map variant", e); }
        }, productId);
  }

  public ProductDtos.VariantView createVariant(ProductDtos.CreateVariantRequest req) {
    long id = snowflakeIdGenerator.generateId();
    execute("INSERT INTO core.product_variant (id, product_id, code, name, price_modifier_type, price_modifier_value, display_order) VALUES (?, ?, ?, ?, ?, ?, ?)",
        id, req.productId(), req.code().trim(), req.name().trim(),
        req.priceModifierType() != null ? req.priceModifierType() : "none",
        req.priceModifierValue() != null ? req.priceModifierValue() : BigDecimal.ZERO,
        req.displayOrder());
    return listVariants(req.productId()).stream().filter(v -> v.id() == id).findFirst().orElseThrow();
  }

  public void deleteVariant(long variantId) {
    execute("DELETE FROM core.product_variant WHERE id = ?", variantId);
  }

  // ── Modifier Groups ──

  public List<ProductDtos.ModifierGroupView> listModifierGroups() {
    List<GroupRow> groups = queryList(
        "SELECT id, code, name, selection_type, min_selections, max_selections, is_active FROM core.modifier_group ORDER BY name",
        rs -> {
          try {
            return new GroupRow(rs.getLong("id"), rs.getString("code"), rs.getString("name"), rs.getString("selection_type"),
                rs.getInt("min_selections"), rs.getInt("max_selections"), rs.getBoolean("is_active"));
          } catch (Exception e) { throw new IllegalStateException("map group", e); }
        });

    if (groups.isEmpty()) return List.of();

    Map<Long, List<ProductDtos.ModifierOptionView>> optionsByGroup = new LinkedHashMap<>();
    for (GroupRow g : groups) {
      List<ProductDtos.ModifierOptionView> opts = queryList(
          "SELECT id, code, name, price_adjustment, display_order, is_active FROM core.modifier_option WHERE modifier_group_id = ? ORDER BY display_order",
          rs -> {
            try {
              return new ProductDtos.ModifierOptionView(rs.getLong("id"), rs.getString("code"), rs.getString("name"),
                  rs.getBigDecimal("price_adjustment"), rs.getInt("display_order"), rs.getBoolean("is_active"));
            } catch (Exception e) { throw new IllegalStateException("map option", e); }
          }, g.id());
      optionsByGroup.put(g.id(), opts);
    }

    return groups.stream().map(g -> new ProductDtos.ModifierGroupView(
        g.id(), g.code(), g.name(), g.selectionType(), g.minSelections(), g.maxSelections(), g.isActive(),
        optionsByGroup.getOrDefault(g.id(), List.of())
    )).toList();
  }

  public ProductDtos.ModifierGroupView createModifierGroup(ProductDtos.CreateModifierGroupRequest req) {
    long id = snowflakeIdGenerator.generateId();
    execute("INSERT INTO core.modifier_group (id, code, name, selection_type, min_selections, max_selections) VALUES (?, ?, ?, ?, ?, ?)",
        id, req.code().trim(), req.name().trim(),
        req.selectionType() != null ? req.selectionType() : "single",
        req.minSelections(), req.maxSelections());
    return listModifierGroups().stream().filter(g -> g.id() == id).findFirst().orElseThrow();
  }

  public ProductDtos.ModifierOptionView addOption(long groupId, ProductDtos.AddModifierOptionRequest req) {
    long id = snowflakeIdGenerator.generateId();
    execute("INSERT INTO core.modifier_option (id, modifier_group_id, code, name, price_adjustment, display_order) VALUES (?, ?, ?, ?, ?, ?)",
        id, groupId, req.code().trim(), req.name().trim(),
        req.priceAdjustment() != null ? req.priceAdjustment() : BigDecimal.ZERO, req.displayOrder());
    return new ProductDtos.ModifierOptionView(id, req.code().trim(), req.name().trim(),
        req.priceAdjustment() != null ? req.priceAdjustment() : BigDecimal.ZERO, req.displayOrder(), true);
  }

  public void deleteOption(long optionId) {
    execute("DELETE FROM core.modifier_option WHERE id = ?", optionId);
  }

  private record GroupRow(long id, String code, String name, String selectionType, int minSelections, int maxSelections, boolean isActive) {}
}
