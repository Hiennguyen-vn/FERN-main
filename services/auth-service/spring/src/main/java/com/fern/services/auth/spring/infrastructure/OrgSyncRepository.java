package com.fern.services.auth.spring.infrastructure;

import com.dorabets.common.repository.BaseRepository;
import com.dorabets.common.spring.auth.CanonicalRole;
import java.sql.Array;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.stream.Collectors;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Repository;

@Repository
public class OrgSyncRepository extends BaseRepository {

  private static final Logger log = LoggerFactory.getLogger(OrgSyncRepository.class);

  private static final Set<String> REGION_SCOPED_CODES = Arrays.stream(CanonicalRole.values())
      .filter(CanonicalRole::regionScoped)
      .map(CanonicalRole::storedRoleCode)
      .collect(Collectors.toUnmodifiableSet());

  private static final Set<String> ALL_MANAGED_CODES;

  static {
    Set<String> all = new LinkedHashSet<>(REGION_SCOPED_CODES);
    all.add(CanonicalRole.SUPERADMIN.storedRoleCode());
    ALL_MANAGED_CODES = Set.copyOf(all);
  }

  public OrgSyncRepository(DataSource dataSource) {
    super(dataSource);
  }

  /**
   * Fan-out superadmin + region-scoped roles to a newly created outlet.
   * Only fans out region-scoped users who already cover ALL existing active outlets in the region
   * (i.e. genuine region-wide admins, not subset admins).
   *
   * @return set of user IDs that received new rows (for cache eviction)
   */
  public Set<Long> fanOutNewOutlet(long newOutletId, long regionId) {
    validateIds(newOutletId, "newOutletId", regionId, "regionId");
    return executeInTransaction(conn -> {
      String[] regionScopedArr = REGION_SCOPED_CODES.toArray(String[]::new);
      String[] superadminArr = new String[]{CanonicalRole.SUPERADMIN.storedRoleCode()};
      String[] allManagedArr = ALL_MANAGED_CODES.toArray(String[]::new);

      Array regionScopedSql = conn.createArrayOf("text", regionScopedArr);
      Array superadminSql = conn.createArrayOf("text", superadminArr);
      Array allManagedSql = conn.createArrayOf("text", allManagedArr);

      int superadminRows = insertSuperadminForNewOutlet(conn, newOutletId, superadminSql);
      int regionScopedRows = insertRegionScopedForNewOutlet(conn, newOutletId, regionId, regionScopedSql);
      log.info("fanOutNewOutlet outletId={} regionId={}: inserted {} superadmin rows, {} region-scoped rows",
          newOutletId, regionId, superadminRows, regionScopedRows);

      Set<Long> affectedUsers = selectUserIdsForOutlet(conn, newOutletId, allManagedSql);
      log.info("fanOutNewOutlet outletId={}: evicting cache for {} users", newOutletId, affectedUsers.size());
      return affectedUsers;
    });
  }

  /**
   * Re-sync region-scoped roles for an outlet that moved to a new region.
   * Removes roles from users not belonging to the new region, adds roles for users who do.
   *
   * @return union of user IDs affected before and after the re-sync (for cache eviction)
   */
  public Set<Long> reSyncOutletRegion(long outletId, long newRegionId) {
    validateIds(outletId, "outletId", newRegionId, "newRegionId");
    return executeInTransaction(conn -> {
      String[] regionScopedArr = REGION_SCOPED_CODES.toArray(String[]::new);
      String[] allManagedArr = ALL_MANAGED_CODES.toArray(String[]::new);

      Array regionScopedSql = conn.createArrayOf("text", regionScopedArr);
      Array allManagedSql = conn.createArrayOf("text", allManagedArr);

      // Capture users before delete for eviction
      Set<Long> preUsers = selectUserIdsForOutlet(conn, outletId, allManagedSql);

      int deleted = deleteStaleRegionScopedRows(conn, outletId, newRegionId, regionScopedSql);
      int inserted = insertNewRegionScopedRows(conn, outletId, newRegionId, regionScopedSql);
      log.info("reSyncOutletRegion outletId={} newRegionId={}: deleted {} stale rows, inserted {} new rows",
          outletId, newRegionId, deleted, inserted);

      Set<Long> postUsers = selectUserIdsForOutlet(conn, outletId, allManagedSql);
      Set<Long> affectedUsers = new LinkedHashSet<>(preUsers);
      affectedUsers.addAll(postUsers);
      log.info("reSyncOutletRegion outletId={}: evicting cache for {} users", outletId, affectedUsers.size());
      return affectedUsers;
    });
  }

  /**
   * Returns the current region_id of the outlet from DB, or null if outlet not found.
   * Used by Handler 2 to detect region mismatch (e.g. manual DB modification).
   */
  public Long findOutletRegionId(long outletId) {
    String sql = "SELECT region_id FROM core.outlet WHERE id = ? AND deleted_at IS NULL";
    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement(sql)) {
      ps.setLong(1, outletId);
      try (ResultSet rs = ps.executeQuery()) {
        return rs.next() ? rs.getLong(1) : null;
      }
    } catch (SQLException e) {
      throw new RuntimeException("findOutletRegionId failed for outletId=" + outletId, e);
    }
  }

  /**
   * Collect user IDs with any managed role in the subtree of the given region.
   * Used by Handler 3 (region parent changed) for cache-only eviction.
   */
  public Set<Long> collectUsersInRegionSubtree(long regionId) {
    if (regionId <= 0) throw new IllegalArgumentException("Invalid regionId: " + regionId);
    String sql = """
        WITH RECURSIVE subtree AS (
          SELECT id FROM core.region WHERE id = ?
          UNION ALL
          SELECT r.id FROM core.region r
          JOIN subtree s ON r.parent_region_id = s.id
        )
        SELECT DISTINCT ur.user_id
        FROM core.user_role ur
        JOIN core.outlet o ON o.id = ur.outlet_id
        WHERE o.region_id IN (SELECT id FROM subtree)
          AND o.deleted_at IS NULL
        """;
    Set<Long> users = new LinkedHashSet<>();
    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement(sql)) {
      ps.setLong(1, regionId);
      try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
          users.add(rs.getLong(1));
        }
      }
    } catch (SQLException e) {
      throw new RuntimeException("collectUsersInRegionSubtree failed for regionId=" + regionId, e);
    }
    log.info("collectUsersInRegionSubtree regionId={}: found {} users to evict", regionId, users.size());
    return users;
  }

  // --- private helpers ---

  private int insertSuperadminForNewOutlet(Connection conn, long newOutletId, Array superadminSql)
      throws SQLException {
    String sql = """
        INSERT INTO core.user_role (user_id, role_code, outlet_id)
        SELECT DISTINCT ur.user_id, ur.role_code, ?
        FROM core.user_role ur
        WHERE ur.role_code = ANY(?)
        ON CONFLICT (user_id, role_code, outlet_id) DO NOTHING
        """;
    try (PreparedStatement ps = conn.prepareStatement(sql)) {
      ps.setLong(1, newOutletId);
      ps.setArray(2, superadminSql);
      return ps.executeUpdate();
    }
  }

  private int insertRegionScopedForNewOutlet(
      Connection conn, long newOutletId, long regionId, Array regionScopedSql
  ) throws SQLException {
    // Only fan-out users who already cover ALL existing active outlets in the region (not subset admins)
    String sql = """
        INSERT INTO core.user_role (user_id, role_code, outlet_id)
        SELECT DISTINCT ur.user_id, ur.role_code, ?
        FROM core.user_role ur
        WHERE ur.role_code = ANY(?)
          AND ur.user_id IN (
            SELECT sub.user_id
            FROM core.user_role sub
            JOIN core.outlet o ON o.id = sub.outlet_id
            WHERE sub.role_code = ur.role_code
              AND o.region_id = ?
              AND o.deleted_at IS NULL
              AND o.id != ?
            GROUP BY sub.user_id
            HAVING COUNT(DISTINCT sub.outlet_id) = (
              SELECT COUNT(*) FROM core.outlet
              WHERE region_id = ? AND deleted_at IS NULL AND id != ?
            )
          )
          AND ur.outlet_id IN (
            SELECT id FROM core.outlet
            WHERE region_id = ? AND deleted_at IS NULL AND id != ?
          )
        ON CONFLICT (user_id, role_code, outlet_id) DO NOTHING
        """;
    try (PreparedStatement ps = conn.prepareStatement(sql)) {
      ps.setLong(1, newOutletId);
      ps.setArray(2, regionScopedSql);
      ps.setLong(3, regionId);
      ps.setLong(4, newOutletId);
      ps.setLong(5, regionId);
      ps.setLong(6, newOutletId);
      ps.setLong(7, regionId);
      ps.setLong(8, newOutletId);
      return ps.executeUpdate();
    }
  }

  private int deleteStaleRegionScopedRows(
      Connection conn, long outletId, long newRegionId, Array regionScopedSql
  ) throws SQLException {
    // Delete per-role: only remove a (user, role_code) row if that user has no row for the SAME
    // role_code in the new region. Correlated via EXISTS to avoid cross-role over-deletion.
    String sql = """
        DELETE FROM core.user_role ur
        WHERE ur.outlet_id = ?
          AND ur.role_code = ANY(?)
          AND NOT EXISTS (
            SELECT 1
            FROM core.user_role sub
            JOIN core.outlet o ON o.id = sub.outlet_id
            WHERE sub.user_id = ur.user_id
              AND sub.role_code = ur.role_code
              AND o.region_id = ?
              AND o.deleted_at IS NULL
              AND o.id != ?
          )
        """;
    try (PreparedStatement ps = conn.prepareStatement(sql)) {
      ps.setLong(1, outletId);
      ps.setArray(2, regionScopedSql);
      ps.setLong(3, newRegionId);
      ps.setLong(4, outletId);
      return ps.executeUpdate();
    }
  }

  private int insertNewRegionScopedRows(
      Connection conn, long outletId, long newRegionId, Array regionScopedSql
  ) throws SQLException {
    // Fan-out from new region, only for users covering all outlets in new region (not subset admins)
    String sql = """
        INSERT INTO core.user_role (user_id, role_code, outlet_id)
        SELECT DISTINCT ur.user_id, ur.role_code, ?
        FROM core.user_role ur
        JOIN core.outlet o ON o.id = ur.outlet_id
        WHERE ur.role_code = ANY(?)
          AND o.region_id = ?
          AND o.deleted_at IS NULL
          AND o.id != ?
          AND ur.user_id IN (
            SELECT sub.user_id
            FROM core.user_role sub
            JOIN core.outlet o2 ON o2.id = sub.outlet_id
            WHERE sub.role_code = ur.role_code
              AND o2.region_id = ?
              AND o2.deleted_at IS NULL
              AND o2.id != ?
            GROUP BY sub.user_id
            HAVING COUNT(DISTINCT sub.outlet_id) = (
              SELECT COUNT(*) FROM core.outlet
              WHERE region_id = ? AND deleted_at IS NULL AND id != ?
            )
          )
        ON CONFLICT (user_id, role_code, outlet_id) DO NOTHING
        """;
    try (PreparedStatement ps = conn.prepareStatement(sql)) {
      ps.setLong(1, outletId);
      ps.setArray(2, regionScopedSql);
      ps.setLong(3, newRegionId);
      ps.setLong(4, outletId);
      ps.setLong(5, newRegionId);
      ps.setLong(6, outletId);
      ps.setLong(7, newRegionId);
      ps.setLong(8, outletId);
      return ps.executeUpdate();
    }
  }

  private Set<Long> selectUserIdsForOutlet(Connection conn, long outletId, Array allManagedSql)
      throws SQLException {
    String sql = """
        SELECT DISTINCT user_id FROM core.user_role
        WHERE outlet_id = ? AND role_code = ANY(?)
        """;
    Set<Long> users = new LinkedHashSet<>();
    try (PreparedStatement ps = conn.prepareStatement(sql)) {
      ps.setLong(1, outletId);
      ps.setArray(2, allManagedSql);
      try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
          users.add(rs.getLong(1));
        }
      }
    }
    return users;
  }

  private static void validateIds(long id1, String name1, long id2, String name2) {
    if (id1 <= 0) throw new IllegalArgumentException("Invalid " + name1 + ": " + id1);
    if (id2 <= 0) throw new IllegalArgumentException("Invalid " + name2 + ": " + id2);
  }
}
