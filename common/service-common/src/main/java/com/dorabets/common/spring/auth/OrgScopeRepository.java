package com.dorabets.common.spring.auth;

import com.dorabets.common.repository.BaseRepository;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import javax.sql.DataSource;
import org.springframework.stereotype.Repository;

@Repository
public class OrgScopeRepository extends BaseRepository {

  public OrgScopeRepository(DataSource dataSource) {
    super(dataSource);
  }

  public record RegionNode(long id, String code, Long parentRegionId) {
  }

  public record OutletNode(long id, long regionId, String code) {
  }

  public record RegionScope(long regionId, String regionCode, Set<Long> outletIds) {
  }

  public record OutletScope(long outletId, long regionId, String outletCode, String regionCode) {
  }

  public List<RegionScope> findAllRegionScopes() {
    List<RegionNode> regions = queryList(
        """
        SELECT id, code, parent_region_id
        FROM core.region
        ORDER BY id
        """,
        this::mapRegion
    );
    List<OutletNode> outlets = findAllOutletNodes();

    Map<Long, RegionNode> regionById = new LinkedHashMap<>();
    Map<Long, List<Long>> childrenByParent = new LinkedHashMap<>();
    Map<Long, Set<Long>> directOutletIdsByRegion = new LinkedHashMap<>();

    for (RegionNode region : regions) {
      regionById.put(region.id(), region);
      childrenByParent.computeIfAbsent(region.id(), ignored -> new ArrayList<>());
      directOutletIdsByRegion.computeIfAbsent(region.id(), ignored -> new LinkedHashSet<>());
    }
    for (RegionNode region : regions) {
      if (region.parentRegionId() != null) {
        childrenByParent.computeIfAbsent(region.parentRegionId(), ignored -> new ArrayList<>()).add(region.id());
      }
    }
    for (OutletNode outlet : outlets) {
      directOutletIdsByRegion.computeIfAbsent(outlet.regionId(), ignored -> new LinkedHashSet<>()).add(outlet.id());
    }

    Map<Long, Set<Long>> memo = new LinkedHashMap<>();
    List<RegionScope> scopes = new ArrayList<>();
    for (RegionNode region : regions) {
      scopes.add(new RegionScope(region.id(), region.code(), collectOutletIds(
          region.id(),
          childrenByParent,
          directOutletIdsByRegion,
          memo
      )));
    }
    scopes.sort(Comparator.comparing(RegionScope::regionId));
    return scopes;
  }

  public Optional<RegionScope> findRegionScopeById(long regionId) {
    return findAllRegionScopes().stream()
        .filter(scope -> scope.regionId() == regionId)
        .findFirst();
  }

  public Optional<RegionScope> findRegionScope(String scopeIdOrCode) {
    if (scopeIdOrCode == null || scopeIdOrCode.isBlank()) {
      return Optional.empty();
    }
    try {
      long regionId = Long.parseLong(scopeIdOrCode.trim());
      return findRegionScopeById(regionId);
    } catch (NumberFormatException ignored) {
      return findAllRegionScopes().stream()
          .filter(scope -> scope.regionCode().equalsIgnoreCase(scopeIdOrCode.trim()))
          .findFirst();
    }
  }

  public Set<Long> findAllActiveOutletIds() {
    LinkedHashSet<Long> outletIds = new LinkedHashSet<>();
    findAllOutletNodes().forEach(outlet -> outletIds.add(outlet.id()));
    return Set.copyOf(outletIds);
  }

  public Optional<OutletScope> findOutletScope(long outletId) {
    Map<Long, String> regionCodes = new LinkedHashMap<>();
    findAllRegionScopes().forEach(scope -> regionCodes.put(scope.regionId(), scope.regionCode()));
    return queryOne(
        """
        SELECT id, region_id, code
        FROM core.outlet
        WHERE id = ? AND deleted_at IS NULL
        """,
        rs -> mapOutletScope(rs, regionCodes),
        outletId
    );
  }

  private List<OutletNode> findAllOutletNodes() {
    return queryList(
        """
        SELECT id, region_id, code
        FROM core.outlet
        WHERE deleted_at IS NULL
        ORDER BY id
        """,
        this::mapOutlet
    );
  }

  private RegionNode mapRegion(ResultSet rs) {
    try {
      return new RegionNode(
          rs.getLong("id"),
          rs.getString("code"),
          rs.getObject("parent_region_id", Long.class)
      );
    } catch (SQLException e) {
      throw new IllegalStateException("Unable to map region scope row", e);
    }
  }

  private OutletNode mapOutlet(ResultSet rs) {
    try {
      return new OutletNode(
          rs.getLong("id"),
          rs.getLong("region_id"),
          rs.getString("code")
      );
    } catch (SQLException e) {
      throw new IllegalStateException("Unable to map outlet scope row", e);
    }
  }

  private OutletScope mapOutletScope(ResultSet rs, Map<Long, String> regionCodes) {
    try {
      long regionId = rs.getLong("region_id");
      return new OutletScope(
          rs.getLong("id"),
          regionId,
          rs.getString("code"),
          regionCodes.get(regionId)
      );
    } catch (SQLException e) {
      throw new IllegalStateException("Unable to map outlet scope", e);
    }
  }

  private Set<Long> collectOutletIds(
      long regionId,
      Map<Long, List<Long>> childrenByParent,
      Map<Long, Set<Long>> directOutletIdsByRegion,
      Map<Long, Set<Long>> memo
  ) {
    if (memo.containsKey(regionId)) {
      return memo.get(regionId);
    }
    LinkedHashSet<Long> outletIds = new LinkedHashSet<>(directOutletIdsByRegion.getOrDefault(regionId, Set.of()));
    for (Long childRegionId : childrenByParent.getOrDefault(regionId, List.of())) {
      outletIds.addAll(collectOutletIds(childRegionId, childrenByParent, directOutletIdsByRegion, memo));
    }
    Set<Long> resolved = Set.copyOf(outletIds);
    memo.put(regionId, resolved);
    return resolved;
  }
}
