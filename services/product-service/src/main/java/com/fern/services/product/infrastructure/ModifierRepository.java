package com.fern.services.product.infrastructure;

import com.fern.common.middleware.ServiceException;
import com.fern.common.repository.BaseRepository;
import com.fern.common.utils.services.id.SnowflakeIdGenerator;
import com.fern.services.product.api.ModifierDtos;
import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import javax.sql.DataSource;
import org.springframework.stereotype.Repository;

@Repository
public class ModifierRepository extends BaseRepository {

  private final SnowflakeIdGenerator idGenerator;

  public ModifierRepository(DataSource dataSource, SnowflakeIdGenerator idGenerator) {
    super(dataSource);
    this.idGenerator = idGenerator;
  }

  // selection_type stored lowercase in legacy schema ('single' / 'multiple'). Translate on read/write.
  private static String dbSelectionType(String input) {
    if (input == null) return "single";
    String lower = input.toLowerCase();
    if (lower.startsWith("multi")) return "multiple";
    return "single";
  }

  private static String apiSelectionType(String dbValue) {
    if (dbValue == null) return "SINGLE";
    return dbValue.startsWith("multi") ? "MULTI" : "SINGLE";
  }

  public List<ModifierDtos.ModifierGroupView> listGroups() {
    return executeInTransaction(conn -> {
      List<Long> ids = new ArrayList<>();
      try (PreparedStatement ps = conn.prepareStatement(
          "SELECT id FROM core.modifier_group ORDER BY name"
      )) {
        try (ResultSet rs = ps.executeQuery()) {
          while (rs.next()) ids.add(rs.getLong(1));
        }
      }
      List<ModifierDtos.ModifierGroupView> out = new ArrayList<>();
      for (Long id : ids) findGroupInternal(conn, id).ifPresent(out::add);
      return out;
    });
  }

  public Optional<ModifierDtos.ModifierGroupView> findGroup(long groupId) {
    return executeInTransaction(conn -> findGroupInternal(conn, groupId));
  }

  public ModifierDtos.ModifierGroupView createGroup(ModifierDtos.CreateModifierGroupRequest req) {
    return executeInTransaction(conn -> {
      long id = idGenerator.generateId();
      String selectionType = dbSelectionType(req.selectionType());
      int minSelect = req.minSelect() == null ? 0 : req.minSelect();
      int maxSelect = req.maxSelect() == null
          ? ("multiple".equals(selectionType) ? 99 : 1)
          : req.maxSelect();
      // `required` carried via min_selections > 0 in legacy schema.
      if (req.required() != null && req.required() && minSelect == 0) {
        minSelect = 1;
      }
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.modifier_group (id, code, name, selection_type, min_selections, max_selections, is_active)
          VALUES (?, ?, ?, ?, ?, ?, true)
          """
      )) {
        ps.setLong(1, id);
        ps.setString(2, req.code());
        ps.setString(3, req.name());
        ps.setString(4, selectionType);
        ps.setInt(5, minSelect);
        ps.setInt(6, maxSelect);
        ps.executeUpdate();
      }
      if (req.options() != null) {
        for (int i = 0; i < req.options().size(); i++) {
          insertOption(conn, id, req.options().get(i), i);
        }
      }
      return findGroupInternal(conn, id)
          .orElseThrow(() -> new IllegalStateException("Group disappeared"));
    });
  }

  public ModifierDtos.ModifierGroupView updateGroup(long groupId, ModifierDtos.UpdateModifierGroupRequest req) {
    return executeInTransaction(conn -> {
      String selectionType = dbSelectionType(req.selectionType());
      int minSelect = req.minSelect();
      if (Boolean.TRUE.equals(req.required()) && minSelect == 0) minSelect = 1;
      try (PreparedStatement ps = conn.prepareStatement(
          """
          UPDATE core.modifier_group
          SET code = ?, name = ?, selection_type = ?, min_selections = ?, max_selections = ?,
              is_active = ?, updated_at = NOW()
          WHERE id = ?
          """
      )) {
        ps.setString(1, req.code());
        ps.setString(2, req.name());
        ps.setString(3, selectionType);
        ps.setInt(4, minSelect);
        ps.setInt(5, req.maxSelect());
        ps.setBoolean(6, req.active());
        ps.setLong(7, groupId);
        if (ps.executeUpdate() == 0) {
          throw ServiceException.notFound("Modifier group not found: " + groupId);
        }
      }
      Set<Long> keepIds = new HashSet<>();
      if (req.options() != null) {
        for (int i = 0; i < req.options().size(); i++) {
          ModifierDtos.UpdateModifierOptionRequest opt = req.options().get(i);
          if (opt.id() != null) {
            try (PreparedStatement ps = conn.prepareStatement(
                """
                UPDATE core.modifier_option
                SET code = ?, name = ?, price_adjustment = ?, is_default = ?, is_active = ?, display_order = ?
                WHERE id = ? AND modifier_group_id = ?
                """
            )) {
              ps.setString(1, opt.code());
              ps.setString(2, opt.label());
              ps.setBigDecimal(3, opt.priceDelta());
              ps.setBoolean(4, opt.isDefault());
              ps.setBoolean(5, opt.active());
              ps.setInt(6, opt.sortOrder());
              ps.setLong(7, opt.id());
              ps.setLong(8, groupId);
              ps.executeUpdate();
            }
            keepIds.add(opt.id());
          } else {
            long newId = idGenerator.generateId();
            try (PreparedStatement ps = conn.prepareStatement(
                """
                INSERT INTO core.modifier_option (id, modifier_group_id, code, name, price_adjustment, is_default, is_active, display_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """
            )) {
              ps.setLong(1, newId);
              ps.setLong(2, groupId);
              ps.setString(3, opt.code());
              ps.setString(4, opt.label());
              ps.setBigDecimal(5, opt.priceDelta());
              ps.setBoolean(6, opt.isDefault());
              ps.setBoolean(7, opt.active());
              ps.setInt(8, opt.sortOrder());
              ps.executeUpdate();
            }
            keepIds.add(newId);
          }
        }
      }
      if (keepIds.isEmpty()) {
        try (PreparedStatement ps = conn.prepareStatement(
            "DELETE FROM core.modifier_option WHERE modifier_group_id = ?"
        )) {
          ps.setLong(1, groupId);
          ps.executeUpdate();
        }
      } else {
        StringBuilder placeholders = new StringBuilder();
        for (int i = 0; i < keepIds.size(); i++) {
          if (i > 0) placeholders.append(',');
          placeholders.append('?');
        }
        try (PreparedStatement ps = conn.prepareStatement(
            "DELETE FROM core.modifier_option WHERE modifier_group_id = ? AND id NOT IN (" + placeholders + ")"
        )) {
          ps.setLong(1, groupId);
          int idx = 2;
          for (Long id : keepIds) ps.setLong(idx++, id);
          ps.executeUpdate();
        }
      }
      return findGroupInternal(conn, groupId)
          .orElseThrow(() -> new IllegalStateException("Group disappeared"));
    });
  }

  public void deleteGroup(long groupId) {
    executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(
          "DELETE FROM core.modifier_group WHERE id = ?"
      )) {
        ps.setLong(1, groupId);
        if (ps.executeUpdate() == 0) {
          throw ServiceException.notFound("Modifier group not found: " + groupId);
        }
      }
      return null;
    });
  }

  public List<ModifierDtos.ModifierGroupView> listForProduct(long productId) {
    return executeInTransaction(conn -> {
      List<Long> groupIds = new ArrayList<>();
      try (PreparedStatement ps = conn.prepareStatement(
          """
          SELECT modifier_group_id FROM core.product_modifier_group
          WHERE product_id = ?
          ORDER BY display_order, modifier_group_id
          """
      )) {
        ps.setLong(1, productId);
        try (ResultSet rs = ps.executeQuery()) {
          while (rs.next()) groupIds.add(rs.getLong(1));
        }
      }
      List<ModifierDtos.ModifierGroupView> out = new ArrayList<>();
      for (Long gid : groupIds) findGroupInternal(conn, gid).ifPresent(out::add);
      return out;
    });
  }

  public List<ModifierDtos.ModifierGroupView> assignToProduct(
      long productId,
      List<ModifierDtos.ProductModifierGroupAssignment> assignments
  ) {
    executeInTransaction(conn -> {
      try (PreparedStatement del = conn.prepareStatement(
          "DELETE FROM core.product_modifier_group WHERE product_id = ?"
      )) {
        del.setLong(1, productId);
        del.executeUpdate();
      }
      if (assignments != null && !assignments.isEmpty()) {
        try (PreparedStatement ins = conn.prepareStatement(
            "INSERT INTO core.product_modifier_group (product_id, modifier_group_id, is_required, display_order) "
            + "VALUES (?, ?, false, ?) "
            + "ON CONFLICT (product_id, modifier_group_id) DO UPDATE SET display_order = EXCLUDED.display_order"
        )) {
          int idx = 0;
          Set<Long> seen = new HashSet<>();
          for (ModifierDtos.ProductModifierGroupAssignment a : assignments) {
            if (a.groupId() == null) continue;
            if (!seen.add(a.groupId())) continue;
            ins.setLong(1, productId);
            ins.setLong(2, a.groupId());
            ins.setInt(3, a.sortOrder() == null ? idx : a.sortOrder());
            ins.addBatch();
            idx++;
          }
          ins.executeBatch();
        }
      }
      return null;
    });
    return listForProduct(productId);
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private void insertOption(
      Connection conn,
      long groupId,
      ModifierDtos.CreateModifierOptionRequest opt,
      int defaultSort
  ) throws SQLException {
    long optId = idGenerator.generateId();
    try (PreparedStatement ps = conn.prepareStatement(
        """
        INSERT INTO core.modifier_option (id, modifier_group_id, code, name, price_adjustment, is_default, display_order)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """
    )) {
      ps.setLong(1, optId);
      ps.setLong(2, groupId);
      ps.setString(3, opt.code());
      ps.setString(4, opt.label());
      ps.setBigDecimal(5, opt.priceDelta() == null ? BigDecimal.ZERO : opt.priceDelta());
      ps.setBoolean(6, opt.isDefault() != null && opt.isDefault());
      ps.setInt(7, opt.sortOrder() == null ? defaultSort : opt.sortOrder());
      ps.executeUpdate();
    }
  }

  private Optional<ModifierDtos.ModifierGroupView> findGroupInternal(Connection conn, long groupId) throws SQLException {
    String groupCode;
    String groupName;
    String selectionType;
    int minSelect;
    int maxSelect;
    boolean active;
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT code, name, selection_type, min_selections, max_selections, is_active
        FROM core.modifier_group
        WHERE id = ?
        """
    )) {
      ps.setLong(1, groupId);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) return Optional.empty();
        groupCode = rs.getString("code");
        groupName = rs.getString("name");
        selectionType = rs.getString("selection_type");
        minSelect = rs.getInt("min_selections");
        maxSelect = rs.getInt("max_selections");
        active = rs.getBoolean("is_active");
      }
    }
    List<ModifierDtos.ModifierOptionView> options = new ArrayList<>();
    try (PreparedStatement po = conn.prepareStatement(
        """
        SELECT id, code, name, price_adjustment, is_default, is_active, display_order
        FROM core.modifier_option
        WHERE modifier_group_id = ?
        ORDER BY display_order, id
        """
    )) {
      po.setLong(1, groupId);
      try (ResultSet rs = po.executeQuery()) {
        while (rs.next()) {
          options.add(new ModifierDtos.ModifierOptionView(
              rs.getLong("id"),
              rs.getString("code"),
              rs.getString("name"),
              rs.getBigDecimal("price_adjustment"),
              rs.getBoolean("is_default"),
              rs.getBoolean("is_active"),
              rs.getInt("display_order")
          ));
        }
      }
    }
    return Optional.of(new ModifierDtos.ModifierGroupView(
        groupId,
        groupCode,
        groupName,
        apiSelectionType(selectionType),
        minSelect,
        maxSelect,
        minSelect > 0,
        active,
        options
    ));
  }
}
