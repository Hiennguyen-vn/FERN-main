package com.dorabets.common.spring.auth;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.repository.BaseRepository;
import com.dorabets.common.spring.cache.JacksonCacheSerializer;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.natsu.common.model.cache.RedisClientAdapter;
import com.natsu.common.model.cache.TieredCache;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import javax.sql.DataSource;
import org.springframework.stereotype.Service;

@Service
public class PermissionMatrixService extends BaseRepository {

  private final TieredCache<PermissionMatrix> permissionCache;

  public PermissionMatrixService(
      DataSource dataSource,
      RedisClientAdapter redisClientAdapter,
      ObjectMapper objectMapper
  ) {
    super(dataSource);
    this.permissionCache = TieredCache.<PermissionMatrix>builder("fern-auth-permissions")
        .localMaxSize(2_000)
        .localTtl(Duration.ofMinutes(2))
        .redisTtl(Duration.ofMinutes(15))
        .redisClient(redisClientAdapter)
        .serializer(new JacksonCacheSerializer<>(objectMapper, new TypeReference<PermissionMatrix>() { }))
        .build();
  }

  public PermissionMatrix load(long userId) {
    return permissionCache.getOrCompute(cacheKey(userId), () -> fetchPermissionMatrix(userId), Duration.ofMinutes(15));
  }

  public void evict(long userId) {
    permissionCache.remove(cacheKey(userId));
  }

  public boolean hasPermission(long userId, long outletId, String permissionCode) {
    PermissionMatrix matrix = load(userId);
    return matrix.hasPermission(outletId, permissionCode)
        || matrix.rolesForOutlet(outletId).contains("admin")
        || matrix.rolesForOutlet(outletId).contains("superadmin");
  }

  public void requirePermission(long userId, long outletId, String permissionCode) {
    if (!hasPermission(userId, outletId, permissionCode)) {
      throw ServiceException.forbidden("Permission denied for outlet " + outletId + ": " + permissionCode);
    }
  }

  private PermissionMatrix fetchPermissionMatrix(long userId) {
    Map<Long, Set<String>> permissions = new LinkedHashMap<>();
    Map<Long, Set<String>> roles = new LinkedHashMap<>();

    List<OutletPermissionRow> directPermissions = queryList(
        """
        SELECT outlet_id, permission_code
        FROM core.user_permission
        WHERE user_id = ?
        """,
        rs -> mapRow(rs),
        userId
    );
    directPermissions.forEach(row -> permissions.computeIfAbsent(row.outletId(), ignored -> new LinkedHashSet<>()).add(row.value()));

    List<OutletPermissionRow> roleRows = queryList(
        """
        SELECT ur.outlet_id, ur.role_code
        FROM core.user_role ur
        WHERE ur.user_id = ?
        """,
        rs -> mapRow(rs),
        userId
    );
    roleRows.forEach(row -> roles.computeIfAbsent(row.outletId(), ignored -> new LinkedHashSet<>()).add(row.value()));

    List<OutletPermissionRow> rolePermissions = queryList(
        """
        SELECT ur.outlet_id, rp.permission_code
        FROM core.user_role ur
        JOIN core.role_permission rp ON rp.role_code = ur.role_code
        WHERE ur.user_id = ?
        """,
        rs -> mapRow(rs),
        userId
    );
    rolePermissions.forEach(row -> permissions.computeIfAbsent(row.outletId(), ignored -> new LinkedHashSet<>()).add(row.value()));

    return new PermissionMatrix(userId, permissions, roles);
  }

  private static String cacheKey(long userId) {
    return "user:" + userId;
  }

  private static OutletPermissionRow mapRow(java.sql.ResultSet rs) {
    try {
      return new OutletPermissionRow(rs.getLong("outlet_id"), rs.getString(2));
    } catch (java.sql.SQLException e) {
      throw new IllegalStateException("Failed to map permission row", e);
    }
  }

  private record OutletPermissionRow(long outletId, String value) {
  }
}
