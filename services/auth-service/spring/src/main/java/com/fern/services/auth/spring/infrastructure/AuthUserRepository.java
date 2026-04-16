package com.fern.services.auth.spring.infrastructure;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.repository.BaseRepository;
import com.dorabets.common.spring.web.PagedResult;
import com.dorabets.common.spring.web.QueryConventions;
import com.fern.services.auth.spring.api.AuthDtos;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import javax.sql.DataSource;
import org.springframework.stereotype.Repository;

@Repository
public class AuthUserRepository extends BaseRepository {

  private static final Set<String> USER_LIST_SORT_KEYS = Set.of("createdAt", "username", "status", "id");
  private static final Set<String> USER_SCOPE_SORT_KEYS = Set.of("username", "outletCode", "createdAt", "userId");
  private static final Set<String> USER_OVERRIDE_SORT_KEYS = Set.of("createdAt", "username", "permissionCode", "outletCode");
  private static final Set<String> PERMISSION_CATALOG_SORT_KEYS = Set.of("code", "name", "module", "assignedRoleCount", "updatedAt");
  private static final Set<String> ROLE_CATALOG_SORT_KEYS = Set.of("code", "name", "assignedPermissionCount", "updatedAt");

  private final SnowflakeIdGenerator snowflakeIdGenerator;
  private final Clock clock;

  public AuthUserRepository(
      DataSource dataSource,
      SnowflakeIdGenerator snowflakeIdGenerator,
      Clock clock
  ) {
    super(dataSource);
    this.snowflakeIdGenerator = snowflakeIdGenerator;
    this.clock = clock;
  }

  public long countActiveUsers() {
    return queryOne(
        "SELECT COUNT(*) FROM core.app_user WHERE deleted_at IS NULL",
        rs -> getLong(rs, 1)
    ).orElse(0L);
  }

  public Optional<AuthUserRecord> findByUsername(String username) {
    return queryOne(
        """
        SELECT id, username, password_hash, full_name, employee_code, email, status, created_at, updated_at
        FROM core.app_user
        WHERE username = ? AND deleted_at IS NULL
        """,
        this::mapAuthUser,
        username
    );
  }

  public Optional<AuthUserRecord> findById(long userId) {
    return queryOne(
        """
        SELECT id, username, password_hash, full_name, employee_code, email, status, created_at, updated_at
        FROM core.app_user
        WHERE id = ? AND deleted_at IS NULL
        """,
        this::mapAuthUser,
        userId
    );
  }

  public PagedResult<AuthDtos.UserListItem> listUsers(
      String username,
      String status,
      Set<Long> scopedOutletIds,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    return executeInTransaction(conn -> {
      StringBuilder sql = new StringBuilder(
          """
          SELECT
            u.id,
            u.username,
            u.full_name,
            u.employee_code,
            u.email,
            u.status,
            u.created_at,
            u.updated_at,
            COUNT(*) OVER() AS total_count
          FROM core.app_user u
          WHERE u.deleted_at IS NULL
          """
      );
      List<Object> params = new ArrayList<>();

      if (username != null && !username.isBlank()) {
        sql.append(" AND u.username ILIKE ?");
        params.add('%' + username.trim() + '%');
      }
      if (status != null && !status.isBlank()) {
        sql.append(" AND u.status = ?::user_status_enum");
        params.add(status.trim());
      }
      appendScopedOutletFilterForUsers(sql, params, scopedOutletIds);

      sql.append(" ORDER BY ").append(resolveUserListSortClause(sortBy, sortDir)).append(" LIMIT ? OFFSET ?");
      params.add(Math.max(1, Math.min(limit, 500)));
      params.add(Math.max(offset, 0));

      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bind(ps, params);
        try (ResultSet rs = ps.executeQuery()) {
          List<AuthDtos.UserListItem> rows = new ArrayList<>();
          long totalCount = 0;
          while (rs.next()) {
            totalCount = rs.getLong("total_count");
            rows.add(mapUserListItem(rs));
          }
          return PagedResult.of(rows, Math.max(1, Math.min(limit, 500)), Math.max(offset, 0), totalCount);
        }
      }
    });
  }

  public PagedResult<AuthDtos.UserScopeView> listScopes(
      Long userId,
      String username,
      Set<Long> scopedOutletIds,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    return executeInTransaction(conn -> {
      StringBuilder sql = new StringBuilder(
          """
          SELECT
            u.id AS user_id,
            u.username,
            u.full_name,
            u.status AS user_status,
            o.id AS outlet_id,
            o.code AS outlet_code,
            o.name AS outlet_name,
            COALESCE(ARRAY_AGG(DISTINCT ur.role_code) FILTER (WHERE ur.role_code IS NOT NULL), ARRAY[]::TEXT[]) AS roles,
            COALESCE(
              ARRAY_AGG(DISTINCT up.permission_code) FILTER (WHERE up.permission_code IS NOT NULL),
              ARRAY[]::TEXT[]
            ) AS permissions,
            COUNT(*) OVER() AS total_count
          FROM core.app_user u
          JOIN core.outlet o ON o.deleted_at IS NULL
          LEFT JOIN core.user_role ur
            ON ur.user_id = u.id
            AND ur.outlet_id = o.id
          LEFT JOIN core.user_permission up
            ON up.user_id = u.id
            AND up.outlet_id = o.id
          WHERE u.deleted_at IS NULL
            AND (ur.user_id IS NOT NULL OR up.user_id IS NOT NULL)
          """
      );
      List<Object> params = new ArrayList<>();

      if (userId != null) {
        sql.append(" AND u.id = ?");
        params.add(userId);
      }
      if (username != null && !username.isBlank()) {
        sql.append(" AND u.username ILIKE ?");
        params.add('%' + username.trim() + '%');
      }
      appendScopedOutletFilter(sql, params, "o.id", scopedOutletIds);

      sql.append(
          " GROUP BY"
              + " u.id,"
              + " u.username,"
              + " u.full_name,"
              + " u.status,"
              + " u.created_at,"
              + " o.id,"
              + " o.code,"
              + " o.name"
              + " ORDER BY "
      ).append(resolveUserScopeSortClause(sortBy, sortDir))
          .append(" LIMIT ? OFFSET ?");
      params.add(Math.max(1, Math.min(limit, 500)));
      params.add(Math.max(offset, 0));

      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bind(ps, params);
        try (ResultSet rs = ps.executeQuery()) {
          List<AuthDtos.UserScopeView> rows = new ArrayList<>();
          long totalCount = 0;
          while (rs.next()) {
            totalCount = rs.getLong("total_count");
            rows.add(mapUserScopeView(rs));
          }
          return PagedResult.of(rows, Math.max(1, Math.min(limit, 500)), Math.max(offset, 0), totalCount);
        }
      }
    });
  }

  public PagedResult<AuthDtos.UserPermissionOverrideView> listOverrides(
      Long userId,
      String username,
      String permissionCode,
      Set<Long> scopedOutletIds,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    return executeInTransaction(conn -> {
      StringBuilder sql = new StringBuilder(
          """
          SELECT
            up.user_id,
            u.username,
            u.full_name,
            u.status AS user_status,
            up.outlet_id,
            o.code AS outlet_code,
            o.name AS outlet_name,
            up.permission_code,
            p.name AS permission_name,
            up.created_at,
            COUNT(*) OVER() AS total_count
          FROM core.user_permission up
          JOIN core.app_user u
            ON u.id = up.user_id
            AND u.deleted_at IS NULL
          JOIN core.outlet o
            ON o.id = up.outlet_id
            AND o.deleted_at IS NULL
          LEFT JOIN core.permission p
            ON p.code = up.permission_code
          WHERE 1 = 1
          """
      );
      List<Object> params = new ArrayList<>();

      if (userId != null) {
        sql.append(" AND up.user_id = ?");
        params.add(userId);
      }
      if (username != null && !username.isBlank()) {
        sql.append(" AND u.username ILIKE ?");
        params.add('%' + username.trim() + '%');
      }
      if (permissionCode != null && !permissionCode.isBlank()) {
        sql.append(" AND up.permission_code = ?");
        params.add(permissionCode.trim());
      }
      appendScopedOutletFilter(sql, params, "up.outlet_id", scopedOutletIds);

      sql.append(" ORDER BY ").append(resolveUserOverrideSortClause(sortBy, sortDir)).append(" LIMIT ? OFFSET ?");
      params.add(Math.max(1, Math.min(limit, 500)));
      params.add(Math.max(offset, 0));

      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bind(ps, params);
        try (ResultSet rs = ps.executeQuery()) {
          List<AuthDtos.UserPermissionOverrideView> rows = new ArrayList<>();
          long totalCount = 0;
          while (rs.next()) {
            totalCount = rs.getLong("total_count");
            rows.add(mapOverrideView(rs));
          }
          return PagedResult.of(rows, Math.max(1, Math.min(limit, 500)), Math.max(offset, 0), totalCount);
        }
      }
    });
  }

  public PagedResult<AuthDtos.PermissionCatalogItem> listPermissionCatalog(
      String module,
      String q,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    return executeInTransaction(conn -> {
      StringBuilder sql = new StringBuilder(
          """
          SELECT
            p.code,
            p.name,
            p.description,
            COALESCE(COUNT(DISTINCT rp.role_code), 0) AS assigned_role_count,
            p.created_at,
            p.updated_at,
            COUNT(*) OVER() AS total_count
          FROM core.permission p
          LEFT JOIN core.role_permission rp ON rp.permission_code = p.code
          WHERE p.deleted_at IS NULL
          """
      );
      List<Object> params = new ArrayList<>();
      if (module != null && !module.isBlank()) {
        sql.append(" AND LOWER(split_part(p.code, '.', 1)) = ?");
        params.add(module.trim().toLowerCase());
      }
      if (q != null && !q.isBlank()) {
        sql.append(" AND (p.code ILIKE ? OR p.name ILIKE ? OR COALESCE(p.description, '') ILIKE ?)");
        String pattern = "%" + q.trim() + "%";
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
      }
      sql.append(" GROUP BY p.code, p.name, p.description, p.created_at, p.updated_at");
      sql.append(" ORDER BY ").append(resolvePermissionCatalogSortClause(sortBy, sortDir));
      sql.append(" LIMIT ? OFFSET ?");
      params.add(Math.max(1, Math.min(limit, 500)));
      params.add(Math.max(offset, 0));

      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bind(ps, params);
        try (ResultSet rs = ps.executeQuery()) {
          List<AuthDtos.PermissionCatalogItem> rows = new ArrayList<>();
          long totalCount = 0;
          while (rs.next()) {
            totalCount = rs.getLong("total_count");
            rows.add(mapPermissionCatalogItem(rs));
          }
          return PagedResult.of(rows, Math.max(1, Math.min(limit, 500)), Math.max(offset, 0), totalCount);
        }
      }
    });
  }

  public PagedResult<AuthDtos.RoleCatalogItem> listRoleCatalog(
      String q,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    return executeInTransaction(conn -> {
      StringBuilder sql = new StringBuilder(
          """
          SELECT
            r.code,
            r.name,
            r.description,
            r.status,
            COALESCE(COUNT(DISTINCT rp.permission_code), 0) AS assigned_permission_count,
            r.created_at,
            r.updated_at,
            COUNT(*) OVER() AS total_count
          FROM core.role r
          LEFT JOIN core.role_permission rp ON rp.role_code = r.code
          WHERE r.deleted_at IS NULL
          """
      );
      List<Object> params = new ArrayList<>();
      if (q != null && !q.isBlank()) {
        sql.append(" AND (r.code ILIKE ? OR r.name ILIKE ? OR COALESCE(r.description, '') ILIKE ?)");
        String pattern = "%" + q.trim() + "%";
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
      }
      sql.append(" GROUP BY r.code, r.name, r.description, r.status, r.created_at, r.updated_at");
      sql.append(" ORDER BY ").append(resolveRoleCatalogSortClause(sortBy, sortDir));
      sql.append(" LIMIT ? OFFSET ?");
      params.add(Math.max(1, Math.min(limit, 500)));
      params.add(Math.max(offset, 0));

      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bind(ps, params);
        try (ResultSet rs = ps.executeQuery()) {
          List<AuthDtos.RoleCatalogItem> rows = new ArrayList<>();
          long totalCount = 0;
          while (rs.next()) {
            totalCount = rs.getLong("total_count");
            rows.add(mapRoleCatalogItem(rs));
          }
          return PagedResult.of(rows, Math.max(1, Math.min(limit, 500)), Math.max(offset, 0), totalCount);
        }
      }
    });
  }

  public AuthUserRecord createUser(CreateUserCommand command) {
    return executeInTransaction(conn -> {
      long userId = snowflakeIdGenerator.generateId();
      Instant now = clock.instant();
      insertUser(conn, userId, command, now);
      insertRoleAssignments(conn, userId, command.outletAccess());
      insertPermissionAssignments(conn, userId, command.outletAccess());
      return findByIdTransactional(conn, userId)
          .orElseThrow(() -> new IllegalStateException("Created user not found: " + userId));
    });
  }

  public RolePermissionUpdateResult replaceRolePermissions(
      String roleCode,
      Set<String> permissionCodes
  ) {
    return executeInTransaction(conn -> {
      if (!exists(conn, "SELECT 1 FROM core.role WHERE code = ? AND deleted_at IS NULL", roleCode)) {
        throw ServiceException.notFound("Role not found: " + roleCode);
      }
      deleteExistingRolePermissions(conn, roleCode);
      insertRolePermissions(conn, roleCode, permissionCodes);
      Instant updatedAt = clock.instant();
      updateRoleTimestamp(conn, roleCode, updatedAt);
      return new RolePermissionUpdateResult(roleCode, Set.copyOf(new LinkedHashSet<>(permissionCodes)), updatedAt);
    });
  }

  public Instant assignRoleToUser(long userId, String roleCode, long outletId) {
    return executeInTransaction(conn -> {
      ensureUserExists(conn, userId);
      Instant now = clock.instant();
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.user_role (user_id, role_code, outlet_id, created_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT (user_id, role_code, outlet_id) DO NOTHING
          """
      )) {
        ps.setLong(1, userId);
        ps.setString(2, roleCode);
        ps.setLong(3, outletId);
        ps.setTimestamp(4, Timestamp.from(now));
        ps.executeUpdate();
      }
      return now;
    });
  }

  public void revokeRoleFromUser(long userId, String roleCode, long outletId) {
    executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(
          "DELETE FROM core.user_role WHERE user_id = ? AND role_code = ? AND outlet_id = ?"
      )) {
        ps.setLong(1, userId);
        ps.setString(2, roleCode);
        ps.setLong(3, outletId);
        int deleted = ps.executeUpdate();
        if (deleted == 0) {
          throw ServiceException.notFound("Role assignment not found");
        }
      }
      return null;
    });
  }

  public Instant grantPermissionToUser(long userId, String permissionCode, long outletId) {
    return executeInTransaction(conn -> {
      ensureUserExists(conn, userId);
      Instant now = clock.instant();
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.user_permission (user_id, permission_code, outlet_id, created_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT (user_id, permission_code, outlet_id) DO NOTHING
          """
      )) {
        ps.setLong(1, userId);
        ps.setString(2, permissionCode);
        ps.setLong(3, outletId);
        ps.setTimestamp(4, Timestamp.from(now));
        ps.executeUpdate();
      }
      return now;
    });
  }

  public void revokePermissionFromUser(long userId, String permissionCode, long outletId) {
    executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(
          "DELETE FROM core.user_permission WHERE user_id = ? AND permission_code = ? AND outlet_id = ?"
      )) {
        ps.setLong(1, userId);
        ps.setString(2, permissionCode);
        ps.setLong(3, outletId);
        int deleted = ps.executeUpdate();
        if (deleted == 0) {
          throw ServiceException.notFound("Permission grant not found");
        }
      }
      return null;
    });
  }

  public Set<Long> findOutletIdsByUserId(long userId) {
    return queryOne(
        """
        SELECT array_agg(DISTINCT outlet_id) FROM (
          SELECT outlet_id FROM core.user_role WHERE user_id = ?
          UNION
          SELECT outlet_id FROM core.user_permission WHERE user_id = ?
        ) t
        """,
        rs -> {
          try {
            java.sql.Array arr = rs.getArray(1);
            if (arr == null) return Set.<Long>of();
            Long[] ids = (Long[]) arr.getArray();
            Set<Long> result = new java.util.HashSet<>();
            for (Long id : ids) if (id != null) result.add(id);
            return result;
          } catch (java.sql.SQLException e) {
            throw new RuntimeException(e);
          }
        },
        userId, userId
    ).orElse(Set.of());
  }

  public AuthUserRecord updateUserStatus(long userId, String newStatus) {
    return executeInTransaction(conn -> {
      Instant now = clock.instant();
      try (PreparedStatement ps = conn.prepareStatement(
          "UPDATE core.app_user SET status = ?::user_status_enum, updated_at = ? WHERE id = ? AND deleted_at IS NULL"
      )) {
        ps.setString(1, newStatus);
        ps.setTimestamp(2, Timestamp.from(now));
        ps.setLong(3, userId);
        int updated = ps.executeUpdate();
        if (updated == 0) {
          throw ServiceException.notFound("User not found: " + userId);
        }
      }
      return findByIdTransactional(conn, userId)
          .orElseThrow(() -> new IllegalStateException("Updated user not found: " + userId));
    });
  }

  public Set<Long> findUserIdsByRoleCode(String roleCode) {
    return new LinkedHashSet<>(queryList(
        """
        SELECT DISTINCT user_id
        FROM core.user_role
        WHERE role_code = ?
        ORDER BY user_id
        """,
        rs -> getLong(rs, 1),
        roleCode
    ));
  }

  private void insertUser(Connection conn, long userId, CreateUserCommand command, Instant now)
      throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        INSERT INTO core.app_user (
          id, username, password_hash, full_name, employee_code, email, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?::user_status_enum, ?, ?)
        """
    )) {
      ps.setLong(1, userId);
      ps.setString(2, command.username());
      ps.setString(3, command.passwordHash());
      ps.setString(4, command.fullName());
      ps.setString(5, command.employeeCode());
      ps.setString(6, command.email());
      ps.setString(7, "active");
      ps.setTimestamp(8, Timestamp.from(now));
      ps.setTimestamp(9, Timestamp.from(now));
      ps.executeUpdate();
    } catch (java.sql.SQLIntegrityConstraintViolationException e) {
      throw ServiceException.conflict("User already exists");
    } catch (java.sql.SQLException e) {
      if ("23505".equals(e.getSQLState())) {
        throw ServiceException.conflict("Username or employee code already exists");
      }
      throw e;
    }
  }

  private void insertRoleAssignments(Connection conn, long userId, List<OutletAccessGrant> outletAccess)
      throws Exception {
    for (OutletAccessGrant grant : outletAccess) {
      for (String roleCode : grant.roles()) {
        try (PreparedStatement ps = conn.prepareStatement(
            """
            INSERT INTO core.user_role (user_id, role_code, outlet_id, created_at)
            VALUES (?, ?, ?, ?)
            """
        )) {
          ps.setLong(1, userId);
          ps.setString(2, roleCode);
          ps.setLong(3, grant.outletId());
          ps.setTimestamp(4, Timestamp.from(clock.instant()));
          ps.executeUpdate();
        }
      }
    }
  }

  private void insertPermissionAssignments(Connection conn, long userId, List<OutletAccessGrant> outletAccess)
      throws Exception {
    for (OutletAccessGrant grant : outletAccess) {
      for (String permissionCode : grant.permissions()) {
        try (PreparedStatement ps = conn.prepareStatement(
            """
            INSERT INTO core.user_permission (user_id, permission_code, outlet_id, created_at)
            VALUES (?, ?, ?, ?)
            """
        )) {
          ps.setLong(1, userId);
          ps.setString(2, permissionCode);
          ps.setLong(3, grant.outletId());
          ps.setTimestamp(4, Timestamp.from(clock.instant()));
          ps.executeUpdate();
        }
      }
    }
  }

  private Optional<AuthUserRecord> findByIdTransactional(Connection conn, long userId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT id, username, password_hash, full_name, employee_code, email, status, created_at, updated_at
        FROM core.app_user
        WHERE id = ? AND deleted_at IS NULL
        """
    )) {
      ps.setLong(1, userId);
      try (ResultSet rs = ps.executeQuery()) {
        if (rs.next()) {
          return Optional.of(mapAuthUser(rs));
        }
        return Optional.empty();
      }
    }
  }

  private void deleteExistingRolePermissions(Connection conn, String roleCode) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        "DELETE FROM core.role_permission WHERE role_code = ?"
    )) {
      ps.setString(1, roleCode);
      ps.executeUpdate();
    }
  }

  private void insertRolePermissions(Connection conn, String roleCode, Set<String> permissionCodes)
      throws Exception {
    for (String permissionCode : permissionCodes) {
      if (!exists(conn, "SELECT 1 FROM core.permission WHERE code = ? AND deleted_at IS NULL", permissionCode)) {
        throw ServiceException.notFound("Permission not found: " + permissionCode);
      }
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.role_permission (role_code, permission_code, created_at)
          VALUES (?, ?, ?)
          """
      )) {
        ps.setString(1, roleCode);
        ps.setString(2, permissionCode);
        ps.setTimestamp(3, Timestamp.from(clock.instant()));
        ps.executeUpdate();
      }
    }
  }

  private void updateRoleTimestamp(Connection conn, String roleCode, Instant updatedAt) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        "UPDATE core.role SET updated_at = ? WHERE code = ?"
    )) {
      ps.setTimestamp(1, Timestamp.from(updatedAt));
      ps.setString(2, roleCode);
      ps.executeUpdate();
    }
  }

  private void ensureUserExists(Connection conn, long userId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        "SELECT 1 FROM core.app_user WHERE id = ? AND deleted_at IS NULL"
    )) {
      ps.setLong(1, userId);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) {
          throw ServiceException.notFound("User not found: " + userId);
        }
      }
    }
  }

  private boolean exists(Connection conn, String sql, String value) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(sql)) {
      ps.setString(1, value);
      try (ResultSet rs = ps.executeQuery()) {
        return rs.next();
      }
    }
  }

  private void appendScopedOutletFilterForUsers(
      StringBuilder sql,
      List<Object> params,
      Set<Long> scopedOutletIds
  ) {
    if (scopedOutletIds == null) {
      return;
    }
    if (scopedOutletIds.isEmpty()) {
      sql.append(" AND 1 = 0");
      return;
    }
    sql.append(
        """
         AND EXISTS (
           SELECT 1
           FROM (
             SELECT ur.outlet_id
             FROM core.user_role ur
             WHERE ur.user_id = u.id
             UNION
             SELECT up.outlet_id
             FROM core.user_permission up
             WHERE up.user_id = u.id
           ) scoped_outlets
           WHERE scoped_outlets.outlet_id IN (
        """
    );
    appendPlaceholders(sql, scopedOutletIds.size());
    sql.append("))");
    params.addAll(scopedOutletIds);
  }

  private void appendScopedOutletFilter(
      StringBuilder sql,
      List<Object> params,
      String column,
      Set<Long> scopedOutletIds
  ) {
    if (scopedOutletIds == null) {
      return;
    }
    if (scopedOutletIds.isEmpty()) {
      sql.append(" AND 1 = 0");
      return;
    }
    sql.append(" AND ").append(column).append(" IN (");
    appendPlaceholders(sql, scopedOutletIds.size());
    sql.append(')');
    params.addAll(scopedOutletIds);
  }

  private void appendPlaceholders(StringBuilder sql, int count) {
    for (int i = 0; i < count; i++) {
      if (i > 0) {
        sql.append(", ");
      }
      sql.append('?');
    }
  }

  private String resolveUserListSortClause(String sortBy, String sortDir) {
    String key = QueryConventions.normalizeSortBy(sortBy, USER_LIST_SORT_KEYS, "createdAt");
    String direction = QueryConventions.normalizeSortDir(sortDir);
    return switch (key) {
      case "username" -> "u.username " + direction + ", u.id " + direction;
      case "status" -> "u.status " + direction + ", u.id " + direction;
      case "id" -> "u.id " + direction;
      case "createdAt" -> "u.created_at " + direction + ", u.id " + direction;
      default -> throw ServiceException.badRequest("Unsupported sortBy for /auth/users");
    };
  }

  private String resolveUserScopeSortClause(String sortBy, String sortDir) {
    String key = QueryConventions.normalizeSortBy(sortBy, USER_SCOPE_SORT_KEYS, "username");
    String direction = QueryConventions.normalizeSortDir(sortDir);
    return switch (key) {
      case "outletCode" -> "o.code " + direction + ", u.username " + direction + ", o.id " + direction;
      case "createdAt" -> "u.created_at " + direction + ", u.username " + direction + ", o.id " + direction;
      case "userId" -> "u.id " + direction + ", o.id " + direction;
      case "username" -> "u.username " + direction + ", o.code " + direction + ", o.id " + direction;
      default -> throw ServiceException.badRequest("Unsupported sortBy for /auth/scopes");
    };
  }

  private String resolveUserOverrideSortClause(String sortBy, String sortDir) {
    String key = QueryConventions.normalizeSortBy(sortBy, USER_OVERRIDE_SORT_KEYS, "createdAt");
    String direction = QueryConventions.normalizeSortDir(sortDir);
    return switch (key) {
      case "username" -> "u.username " + direction + ", up.created_at " + direction + ", up.user_id " + direction;
      case "permissionCode" -> "up.permission_code " + direction + ", up.created_at " + direction + ", up.user_id " + direction;
      case "outletCode" -> "o.code " + direction + ", up.created_at " + direction + ", up.user_id " + direction;
      case "createdAt" -> "up.created_at " + direction + ", up.user_id " + direction;
      default -> throw ServiceException.badRequest("Unsupported sortBy for /auth/overrides");
    };
  }

  private String resolvePermissionCatalogSortClause(String sortBy, String sortDir) {
    String key = QueryConventions.normalizeSortBy(sortBy, PERMISSION_CATALOG_SORT_KEYS, "code");
    String direction = QueryConventions.normalizeSortDir(sortDir);
    return switch (key) {
      case "name" -> "p.name " + direction + ", p.code " + direction;
      case "module" -> "split_part(p.code, '.', 1) " + direction + ", p.code " + direction;
      case "assignedRoleCount" -> "assigned_role_count " + direction + ", p.code " + direction;
      case "updatedAt" -> "p.updated_at " + direction + ", p.code " + direction;
      case "code" -> "p.code " + direction;
      default -> throw ServiceException.badRequest("Unsupported sortBy for /auth/permissions");
    };
  }

  private String resolveRoleCatalogSortClause(String sortBy, String sortDir) {
    String key = QueryConventions.normalizeSortBy(sortBy, ROLE_CATALOG_SORT_KEYS, "code");
    String direction = QueryConventions.normalizeSortDir(sortDir);
    return switch (key) {
      case "name" -> "r.name " + direction + ", r.code " + direction;
      case "assignedPermissionCount" -> "assigned_permission_count " + direction + ", r.code " + direction;
      case "updatedAt" -> "r.updated_at " + direction + ", r.code " + direction;
      case "code" -> "r.code " + direction;
      default -> throw ServiceException.badRequest("Unsupported sortBy for /auth/roles");
    };
  }

  private void bind(PreparedStatement ps, List<Object> params) throws SQLException {
    for (int i = 0; i < params.size(); i++) {
      ps.setObject(i + 1, params.get(i));
    }
  }

  private AuthDtos.UserListItem mapUserListItem(ResultSet rs) {
    try {
      return new AuthDtos.UserListItem(
          rs.getLong("id"),
          rs.getString("username"),
          rs.getString("full_name"),
          rs.getString("employee_code"),
          rs.getString("email"),
          rs.getString("status"),
          rs.getTimestamp("created_at").toInstant(),
          rs.getTimestamp("updated_at").toInstant()
      );
    } catch (SQLException e) {
      throw new IllegalStateException("Unable to map auth user list row", e);
    }
  }

  private AuthDtos.UserScopeView mapUserScopeView(ResultSet rs) {
    try {
      return new AuthDtos.UserScopeView(
          rs.getLong("user_id"),
          rs.getString("username"),
          rs.getString("full_name"),
          rs.getString("user_status"),
          rs.getLong("outlet_id"),
          rs.getString("outlet_code"),
          rs.getString("outlet_name"),
          toStringSet(rs.getArray("roles")),
          toStringSet(rs.getArray("permissions"))
      );
    } catch (SQLException e) {
      throw new IllegalStateException("Unable to map auth scope row", e);
    }
  }

  private AuthDtos.UserPermissionOverrideView mapOverrideView(ResultSet rs) {
    try {
      return new AuthDtos.UserPermissionOverrideView(
          rs.getLong("user_id"),
          rs.getString("username"),
          rs.getString("full_name"),
          rs.getString("user_status"),
          rs.getLong("outlet_id"),
          rs.getString("outlet_code"),
          rs.getString("outlet_name"),
          rs.getString("permission_code"),
          rs.getString("permission_name"),
          rs.getTimestamp("created_at").toInstant()
      );
    } catch (SQLException e) {
      throw new IllegalStateException("Unable to map auth override row", e);
    }
  }

  private AuthDtos.PermissionCatalogItem mapPermissionCatalogItem(ResultSet rs) {
    try {
      String code = rs.getString("code");
      String module = code == null ? "" : code.split("\\.", 2)[0];
      return new AuthDtos.PermissionCatalogItem(
          code,
          rs.getString("name"),
          rs.getString("description"),
          module,
          true,
          rs.getLong("assigned_role_count"),
          rs.getTimestamp("created_at").toInstant(),
          rs.getTimestamp("updated_at").toInstant()
      );
    } catch (SQLException e) {
      throw new IllegalStateException("Unable to map permission catalog row", e);
    }
  }

  private AuthDtos.RoleCatalogItem mapRoleCatalogItem(ResultSet rs) {
    try {
      String status = rs.getString("status");
      return new AuthDtos.RoleCatalogItem(
          rs.getString("code"),
          rs.getString("name"),
          rs.getString("description"),
          status == null || "active".equalsIgnoreCase(status),
          rs.getLong("assigned_permission_count"),
          rs.getTimestamp("created_at").toInstant(),
          rs.getTimestamp("updated_at").toInstant()
      );
    } catch (SQLException e) {
      throw new IllegalStateException("Unable to map role catalog row", e);
    }
  }

  private Set<String> toStringSet(java.sql.Array array) throws SQLException {
    if (array == null) {
      return Set.of();
    }
    Object raw = array.getArray();
    if (!(raw instanceof Object[] values)) {
      return Set.of();
    }
    return Arrays.stream(values)
        .filter(value -> value != null && !String.valueOf(value).isBlank())
        .map(value -> String.valueOf(value).trim())
        .collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new));
  }

  private AuthUserRecord mapAuthUser(ResultSet rs) {
    try {
      return new AuthUserRecord(
          rs.getLong("id"),
          rs.getString("username"),
          rs.getString("password_hash"),
          rs.getString("full_name"),
          rs.getString("employee_code"),
          rs.getString("email"),
          rs.getString("status"),
          rs.getTimestamp("created_at").toInstant(),
          rs.getTimestamp("updated_at").toInstant()
      );
    } catch (Exception e) {
      throw new IllegalStateException("Unable to map auth user", e);
    }
  }

  private static long getLong(ResultSet rs, int index) {
    try {
      return rs.getLong(index);
    } catch (Exception e) {
      throw new IllegalStateException("Unable to map numeric result", e);
    }
  }

  public record AuthUserRecord(
      long id,
      String username,
      String passwordHash,
      String fullName,
      String employeeCode,
      String email,
      String status,
      Instant createdAt,
      Instant updatedAt
  ) {
  }

  public record OutletAccessGrant(
      long outletId,
      Set<String> roles,
      Set<String> permissions
  ) {
    public OutletAccessGrant {
      roles = roles == null ? Set.of() : Set.copyOf(roles);
      permissions = permissions == null ? Set.of() : Set.copyOf(permissions);
    }
  }

  public record CreateUserCommand(
      String username,
      String passwordHash,
      String fullName,
      String employeeCode,
      String email,
      List<OutletAccessGrant> outletAccess
  ) {
    public CreateUserCommand {
      outletAccess = outletAccess == null ? List.of() : List.copyOf(outletAccess);
    }
  }

  public record RolePermissionUpdateResult(
      String roleCode,
      Set<String> permissionCodes,
      Instant updatedAt
  ) {
  }
}
