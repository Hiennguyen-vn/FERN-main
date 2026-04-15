package com.dorabets.common.spring.auth;

import com.dorabets.common.middleware.ServiceException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.springframework.stereotype.Service;

@Service
public class AuthorizationPolicyService {

  private static final Set<CanonicalRole> OUTLET_ADMIN_ASSIGNABLE = EnumSet.of(
      CanonicalRole.OUTLET_MANAGER,
      CanonicalRole.STAFF,
      CanonicalRole.PROCUREMENT,
      CanonicalRole.KITCHEN_STAFF
  );
  private static final Set<CanonicalRole> REGION_ADMIN_ASSIGNABLE = EnumSet.of(
      CanonicalRole.REGION_MANAGER,
      CanonicalRole.OUTLET_MANAGER,
      CanonicalRole.STAFF,
      CanonicalRole.PROCUREMENT,
      CanonicalRole.PRODUCT_MANAGER,
      CanonicalRole.FINANCE,
      CanonicalRole.KITCHEN_STAFF,
      CanonicalRole.HR
  );
  private static final Set<CanonicalRole> OUTLET_MANAGER_CONTRACT_ROLES = EnumSet.of(
      CanonicalRole.OUTLET_MANAGER,
      CanonicalRole.STAFF,
      CanonicalRole.PROCUREMENT,
      CanonicalRole.KITCHEN_STAFF
  );

  private final PermissionMatrixService permissionMatrixService;
  private final OrgScopeRepository orgScopeRepository;
  private final RoleAliasResolver roleAliasResolver;

  public AuthorizationPolicyService(
      PermissionMatrixService permissionMatrixService,
      OrgScopeRepository orgScopeRepository,
      RoleAliasResolver roleAliasResolver
  ) {
    this.permissionMatrixService = permissionMatrixService;
    this.orgScopeRepository = orgScopeRepository;
    this.roleAliasResolver = roleAliasResolver;
  }

  public List<CanonicalRole> businessRoles() {
    return List.of(CanonicalRole.values());
  }

  public BusinessUserProfile resolveUserProfile(long userId) {
    return resolveUserProfile(userId, permissionMatrixService.load(userId));
  }

  public BusinessUserProfile resolveUserProfile(long userId, PermissionMatrix matrix) {
    Map<CanonicalRole, Set<Long>> outletsByRole = new EnumMap<>(CanonicalRole.class);
    Map<CanonicalRole, Map<Long, Set<String>>> sourcesByRoleAndOutlet = new EnumMap<>(CanonicalRole.class);

    matrix.rolesByOutlet().forEach((outletId, roleCodes) -> roleCodes.forEach(roleCode ->
        roleAliasResolver.toCanonicalRole(roleCode).ifPresent(canonicalRole -> {
          outletsByRole.computeIfAbsent(canonicalRole, ignored -> new LinkedHashSet<>()).add(outletId);
          sourcesByRoleAndOutlet.computeIfAbsent(canonicalRole, ignored -> new LinkedHashMap<>())
              .computeIfAbsent(outletId, ignored -> new LinkedHashSet<>())
              .add(roleCode);
        })
    ));

    List<BusinessScopeAssignment> assignments = new ArrayList<>();
    Set<Long> allActiveOutlets = orgScopeRepository.findAllActiveOutletIds();
    Set<Long> superadminOutlets = new LinkedHashSet<>(outletsByRole.getOrDefault(CanonicalRole.SUPERADMIN, Set.of()));
    if (!superadminOutlets.isEmpty() && !allActiveOutlets.isEmpty() && superadminOutlets.containsAll(allActiveOutlets)) {
      assignments.add(new BusinessScopeAssignment(
          CanonicalRole.SUPERADMIN,
          ScopeType.GLOBAL,
          null,
          "global",
          allActiveOutlets,
          collectSourceRoleCodes(sourcesByRoleAndOutlet.get(CanonicalRole.SUPERADMIN), allActiveOutlets)
      ));
      superadminOutlets.removeAll(allActiveOutlets);
    }
    addOutletAssignments(assignments, CanonicalRole.SUPERADMIN, superadminOutlets, sourcesByRoleAndOutlet);

    List<OrgScopeRepository.RegionScope> regionScopes = orgScopeRepository.findAllRegionScopes().stream()
        .sorted(Comparator.comparingInt((OrgScopeRepository.RegionScope scope) -> scope.outletIds().size()).reversed()
            .thenComparing(OrgScopeRepository.RegionScope::regionId))
        .toList();

    for (CanonicalRole canonicalRole : CanonicalRole.values()) {
      if (canonicalRole == CanonicalRole.SUPERADMIN) {
        continue;
      }
      Set<Long> remaining = new LinkedHashSet<>(outletsByRole.getOrDefault(canonicalRole, Set.of()));
      if (canonicalRole.regionScoped()) {
        for (OrgScopeRepository.RegionScope regionScope : regionScopes) {
          if (!regionScope.outletIds().isEmpty() && remaining.containsAll(regionScope.outletIds())) {
            assignments.add(new BusinessScopeAssignment(
                canonicalRole,
                ScopeType.REGION,
                regionScope.regionId(),
                regionScope.regionCode(),
                regionScope.outletIds(),
                collectSourceRoleCodes(sourcesByRoleAndOutlet.get(canonicalRole), regionScope.outletIds())
            ));
            remaining.removeAll(regionScope.outletIds());
          }
        }
      }
      addOutletAssignments(assignments, canonicalRole, remaining, sourcesByRoleAndOutlet);
    }

    LinkedHashSet<CanonicalRole> canonicalRoles = new LinkedHashSet<>();
    LinkedHashSet<Long> outletIds = new LinkedHashSet<>();
    assignments.forEach(assignment -> {
      canonicalRoles.add(assignment.role());
      outletIds.addAll(assignment.outletIds());
    });
    return new BusinessUserProfile(userId, canonicalRoles, assignments, outletIds);
  }

  public Set<Long> resolveGovernedOutletIds(RequestUserContext context) {
    if (context.internalService()) {
      return null;
    }
    long userId = context.requireUserId();
    BusinessUserProfile profile = resolveUserProfile(userId);
    if (profile.hasGlobalRole(CanonicalRole.SUPERADMIN)) {
      return null;
    }
    Set<Long> governedOutletIds = profile.outletsForRole(CanonicalRole.ADMIN);
    if (!governedOutletIds.isEmpty()) {
      return governedOutletIds;
    }
    PermissionMatrix matrix = permissionMatrixService.load(userId);
    LinkedHashSet<Long> fallback = new LinkedHashSet<>();
    matrix.permissionsByOutlet().forEach((outletId, permissionCodes) -> {
      if (permissionCodes.contains("auth.user.write") || permissionCodes.contains("auth.role.write")) {
        fallback.add(outletId);
      }
    });
    return fallback;
  }

  public void requireGovernedOutlets(RequestUserContext context, Set<Long> outletIds) {
    Set<Long> governedOutletIds = resolveGovernedOutletIds(context);
    if (governedOutletIds == null) {
      return;
    }
    if (outletIds == null || outletIds.isEmpty()) {
      return;
    }
    if (!governedOutletIds.containsAll(outletIds)) {
      throw ServiceException.forbidden("Requested scope is outside governed outlets");
    }
  }

  public boolean canAssignRole(RequestUserContext context, String requestedRoleCode, Set<Long> outletIds) {
    if (context.internalService()) {
      return true;
    }
    long userId = context.requireUserId();
    BusinessUserProfile profile = resolveUserProfile(userId);
    if (profile.hasGlobalRole(CanonicalRole.SUPERADMIN)) {
      return true;
    }
    Optional<CanonicalRole> requestedRole = roleAliasResolver.toCanonicalRole(requestedRoleCode);
    if (requestedRole.isEmpty()) {
      return false;
    }
    if (requestedRole.get() == CanonicalRole.SUPERADMIN || requestedRole.get() == CanonicalRole.ADMIN) {
      return false;
    }
    for (Long outletId : outletIds) {
      if (!canAssignRoleAtOutlet(profile, requestedRole.get(), outletId)) {
        return false;
      }
    }
    return true;
  }

  public boolean canManageHrSchedule(RequestUserContext context, long outletId, boolean mutation) {
    AuthorizationDecision decision = evaluateHrSchedule(context, outletId, mutation);
    return decision.allowed();
  }

  public AuthorizationDecision evaluateHrSchedule(RequestUserContext context, long outletId, boolean mutation) {
    if (context.internalService()) {
      return AuthorizationDecision.allow("internal_service", Set.of(outletId));
    }
    long userId = context.requireUserId();
    BusinessUserProfile profile = resolveUserProfile(userId);
    if (profile.hasGlobalRole(CanonicalRole.SUPERADMIN)) {
      return AuthorizationDecision.allow("superadmin", Set.of(outletId));
    }
    if (profile.hasRoleForOutlet(CanonicalRole.HR, outletId)) {
      return AuthorizationDecision.allow("hr_region", Set.of(outletId));
    }
    if (profile.hasRoleForOutlet(CanonicalRole.OUTLET_MANAGER, outletId)) {
      return AuthorizationDecision.allow("outlet_manager", Set.of(outletId));
    }
    PermissionMatrix matrix = permissionMatrixService.load(userId);
    if (matrix.hasPermission(outletId, "hr.schedule")) {
      return AuthorizationDecision.allow("permission:hr.schedule", Set.of(outletId));
    }
    if (!mutation && context.outletIds().contains(outletId)) {
      return AuthorizationDecision.allow("outlet_membership", Set.of(outletId));
    }
    return AuthorizationDecision.deny("missing_hr_schedule_access");
  }

  public boolean canPreparePayroll(RequestUserContext context, long regionId) {
    if (context.internalService()) {
      return true;
    }
    long userId = context.requireUserId();
    BusinessUserProfile profile = resolveUserProfile(userId);
    return profile.hasGlobalRole(CanonicalRole.SUPERADMIN)
        || profile.hasRoleForRegion(regionId, CanonicalRole.HR);
  }

  public boolean canApprovePayroll(RequestUserContext context, long regionId) {
    if (context.internalService()) {
      return true;
    }
    long userId = context.requireUserId();
    BusinessUserProfile profile = resolveUserProfile(userId);
    return profile.hasGlobalRole(CanonicalRole.SUPERADMIN)
        || profile.hasRoleForRegion(regionId, CanonicalRole.FINANCE);
  }

  public Set<Long> payrollPreparationRegionIds(RequestUserContext context) {
    if (context.internalService()) {
      return null;
    }
    long userId = context.requireUserId();
    BusinessUserProfile profile = resolveUserProfile(userId);
    if (profile.hasGlobalRole(CanonicalRole.SUPERADMIN)) {
      return null;
    }
    return profile.regionIdsForRole(CanonicalRole.HR);
  }

  public Set<Long> payrollApprovalRegionIds(RequestUserContext context) {
    if (context.internalService()) {
      return null;
    }
    long userId = context.requireUserId();
    BusinessUserProfile profile = resolveUserProfile(userId);
    if (profile.hasGlobalRole(CanonicalRole.SUPERADMIN)) {
      return null;
    }
    return profile.regionIdsForRole(CanonicalRole.FINANCE);
  }

  public boolean canManageContractForUser(RequestUserContext context, long targetUserId, String contractRegionCode) {
    if (context.internalService()) {
      return true;
    }
    long actorUserId = context.requireUserId();
    BusinessUserProfile actorProfile = resolveUserProfile(actorUserId);
    if (actorProfile.hasGlobalRole(CanonicalRole.SUPERADMIN)) {
      return true;
    }
    BusinessUserProfile targetProfile = resolveUserProfile(targetUserId);
    if (canManageContractAsHr(actorProfile, targetProfile, contractRegionCode)) {
      return true;
    }
    return canManageContractAsOutletManager(actorProfile, targetProfile);
  }

  public boolean canReadContractsInScope(RequestUserContext context, Set<Long> targetOutletIds, String regionCode) {
    if (context.internalService()) {
      return true;
    }
    long userId = context.requireUserId();
    BusinessUserProfile profile = resolveUserProfile(userId);
    if (profile.hasGlobalRole(CanonicalRole.SUPERADMIN)) {
      return true;
    }
    if (!targetOutletIds.isEmpty() && profile.outletsForRole(CanonicalRole.HR).containsAll(targetOutletIds)) {
      return true;
    }
    if (regionCode != null && profile.hasRoleForRegionCode(regionCode, CanonicalRole.HR)) {
      return true;
    }
    return !targetOutletIds.isEmpty() && profile.outletsForRole(CanonicalRole.OUTLET_MANAGER).containsAll(targetOutletIds);
  }

  private boolean canManageContractAsHr(
      BusinessUserProfile actorProfile,
      BusinessUserProfile targetProfile,
      String contractRegionCode
  ) {
    if (!targetProfile.outletIds().isEmpty()
        && actorProfile.outletsForRole(CanonicalRole.HR).containsAll(targetProfile.outletIds())) {
      return true;
    }
    return contractRegionCode != null && actorProfile.hasRoleForRegionCode(contractRegionCode, CanonicalRole.HR);
  }

  private boolean canManageContractAsOutletManager(
      BusinessUserProfile actorProfile,
      BusinessUserProfile targetProfile
  ) {
    if (targetProfile.outletIds().isEmpty()) {
      return false;
    }
    if (!actorProfile.outletsForRole(CanonicalRole.OUTLET_MANAGER).containsAll(targetProfile.outletIds())) {
      return false;
    }
    if (targetProfile.canonicalRoles().isEmpty()) {
      return true;
    }
    return OUTLET_MANAGER_CONTRACT_ROLES.containsAll(targetProfile.canonicalRoles());
  }

  // --- Org domain ---

  public boolean canReadOrg(RequestUserContext context) {
    if (context.internalService()) {
      return true;
    }
    context.requireUserId();
    return true;
  }

  /**
   * Full unfiltered org read — superadmin only.
   * Admin and region_manager use scoped access via {@link #resolveOrgReadableOutletIds}.
   * See business rules §5.1 and §8.1 (admin is governance-only, scoped).
   */
  public boolean hasAdministrativeOrgAccess(RequestUserContext context) {
    if (context.internalService()) {
      return true;
    }
    long userId = context.requireUserId();
    BusinessUserProfile profile = resolveUserProfile(userId);
    return profile.hasGlobalRole(CanonicalRole.SUPERADMIN);
  }

  /**
   * Resolves the set of outlet IDs an admin or region_manager can see
   * in org read operations. Returns null for superadmin (all outlets).
   */
  public Set<Long> resolveOrgReadableOutletIds(RequestUserContext context) {
    if (context.internalService()) {
      return null;
    }
    long userId = context.requireUserId();
    BusinessUserProfile profile = resolveUserProfile(userId);
    if (profile.hasGlobalRole(CanonicalRole.SUPERADMIN)) {
      return null;
    }
    // Admin: scoped to governed outlets (§8.1)
    if (profile.canonicalRoles().contains(CanonicalRole.ADMIN)) {
      return profile.outletsForRole(CanonicalRole.ADMIN);
    }
    // Region manager: scoped to region outlets (§5.1)
    if (profile.canonicalRoles().contains(CanonicalRole.REGION_MANAGER)) {
      return profile.outletsForRole(CanonicalRole.REGION_MANAGER);
    }
    // Other roles: scoped to their outlet assignments
    return context.outletIds();
  }

  public boolean canMutateOrg(RequestUserContext context) {
    if (context.internalService()) {
      return true;
    }
    long userId = context.requireUserId();
    BusinessUserProfile profile = resolveUserProfile(userId);
    return profile.hasGlobalRole(CanonicalRole.SUPERADMIN)
        || profile.canonicalRoles().contains(CanonicalRole.ADMIN);
  }

  // --- Catalog / Product domain ---

  public boolean canMutateCatalog(RequestUserContext context) {
    if (context.internalService()) {
      return true;
    }
    long userId = context.requireUserId();
    BusinessUserProfile profile = resolveUserProfile(userId);
    if (profile.hasGlobalRole(CanonicalRole.SUPERADMIN)) {
      return true;
    }
    if (profile.canonicalRoles().contains(CanonicalRole.PRODUCT_MANAGER)) {
      return true;
    }
    PermissionMatrix matrix = permissionMatrixService.load(userId);
    return context.outletIds().stream()
        .anyMatch(outletId -> matrix.hasPermission(outletId, "product.catalog.write"));
  }

  public boolean canReadCatalogForOutlet(RequestUserContext context, long outletId) {
    if (context.internalService()) {
      return true;
    }
    long userId = context.requireUserId();
    BusinessUserProfile profile = resolveUserProfile(userId);
    if (profile.hasGlobalRole(CanonicalRole.SUPERADMIN)) {
      return true;
    }
    if (profile.canonicalRoles().contains(CanonicalRole.PRODUCT_MANAGER)
        || profile.canonicalRoles().contains(CanonicalRole.REGION_MANAGER)) {
      return profile.outletIds().contains(outletId);
    }
    return context.outletIds().contains(outletId);
  }

  // --- Sales domain ---

  public boolean canWriteSales(RequestUserContext context) {
    if (context.internalService()) {
      return true;
    }
    long userId = context.requireUserId();
    BusinessUserProfile profile = resolveUserProfile(userId);
    if (profile.hasGlobalRole(CanonicalRole.SUPERADMIN)) {
      return true;
    }
    if (profile.canonicalRoles().contains(CanonicalRole.OUTLET_MANAGER)
        || profile.canonicalRoles().contains(CanonicalRole.STAFF)) {
      return true;
    }
    PermissionMatrix matrix = permissionMatrixService.load(userId);
    return context.outletIds().stream()
        .anyMatch(outletId -> matrix.hasPermission(outletId, "sales.order.write"));
  }

  public boolean canWriteSalesForOutlet(RequestUserContext context, long outletId) {
    if (context.internalService()) {
      return true;
    }
    long userId = context.requireUserId();
    BusinessUserProfile profile = resolveUserProfile(userId);
    if (profile.hasGlobalRole(CanonicalRole.SUPERADMIN)) {
      return true;
    }
    if (profile.hasRoleForOutlet(CanonicalRole.OUTLET_MANAGER, outletId)
        || profile.hasRoleForOutlet(CanonicalRole.STAFF, outletId)) {
      return true;
    }
    PermissionMatrix matrix = permissionMatrixService.load(userId);
    return matrix.hasPermission(outletId, "sales.order.write");
  }

  public Set<Long> resolveSalesReadableOutletIds(RequestUserContext context) {
    if (context.internalService()) {
      return null;
    }
    long userId = context.requireUserId();
    BusinessUserProfile profile = resolveUserProfile(userId);
    if (profile.hasGlobalRole(CanonicalRole.SUPERADMIN)) {
      return null;
    }
    if (profile.canonicalRoles().contains(CanonicalRole.REGION_MANAGER)) {
      return profile.outletIds();
    }
    return context.outletIds();
  }

  // --- Procurement domain ---

  public boolean canWriteProcurement(RequestUserContext context, long outletId) {
    if (context.internalService()) {
      return true;
    }
    long userId = context.requireUserId();
    BusinessUserProfile profile = resolveUserProfile(userId);
    if (profile.hasGlobalRole(CanonicalRole.SUPERADMIN)) {
      return true;
    }
    if (profile.hasRoleForOutlet(CanonicalRole.OUTLET_MANAGER, outletId)) {
      return true;
    }
    if (profile.hasRoleForOutlet(CanonicalRole.PROCUREMENT, outletId)) {
      return true;
    }
    PermissionMatrix matrix = permissionMatrixService.load(userId);
    return matrix.hasPermission(outletId, "purchase.write");
  }

  public boolean canApproveProcurement(RequestUserContext context, long outletId) {
    if (context.internalService()) {
      return true;
    }
    long userId = context.requireUserId();
    BusinessUserProfile profile = resolveUserProfile(userId);
    if (profile.hasGlobalRole(CanonicalRole.SUPERADMIN)) {
      return true;
    }
    if (profile.hasRoleForOutlet(CanonicalRole.OUTLET_MANAGER, outletId)) {
      return true;
    }
    PermissionMatrix matrix = permissionMatrixService.load(userId);
    return matrix.hasPermission(outletId, "purchase.approve");
  }

  public boolean canReadProcurement(RequestUserContext context, long outletId) {
    if (context.internalService()) {
      return true;
    }
    long userId = context.requireUserId();
    BusinessUserProfile profile = resolveUserProfile(userId);
    if (profile.hasGlobalRole(CanonicalRole.SUPERADMIN)) {
      return true;
    }
    if (profile.hasRoleForOutlet(CanonicalRole.PROCUREMENT, outletId)
        || profile.hasRoleForOutlet(CanonicalRole.OUTLET_MANAGER, outletId)) {
      return true;
    }
    return context.outletIds().contains(outletId);
  }

  public Set<Long> resolveProcurementReadableOutletIds(RequestUserContext context) {
    if (context.internalService()) {
      return null;
    }
    long userId = context.requireUserId();
    BusinessUserProfile profile = resolveUserProfile(userId);
    if (profile.hasGlobalRole(CanonicalRole.SUPERADMIN)) {
      return null;
    }
    LinkedHashSet<Long> result = new LinkedHashSet<>();
    result.addAll(profile.outletsForRole(CanonicalRole.PROCUREMENT));
    result.addAll(profile.outletsForRole(CanonicalRole.OUTLET_MANAGER));
    result.addAll(context.outletIds());
    if (result.isEmpty()) {
      throw ServiceException.forbidden("Procurement read access requires outlet scope");
    }
    return Set.copyOf(result);
  }

  // --- Inventory domain ---

  public boolean canWriteInventory(RequestUserContext context, long outletId) {
    if (context.internalService()) {
      return true;
    }
    long userId = context.requireUserId();
    BusinessUserProfile profile = resolveUserProfile(userId);
    if (profile.hasGlobalRole(CanonicalRole.SUPERADMIN)) {
      return true;
    }
    if (profile.hasRoleForOutlet(CanonicalRole.OUTLET_MANAGER, outletId)) {
      return true;
    }
    PermissionMatrix matrix = permissionMatrixService.load(userId);
    return matrix.hasPermission(outletId, "inventory.write");
  }

  public Set<Long> resolveInventoryReadableOutletIds(RequestUserContext context) {
    if (context.internalService()) {
      return null;
    }
    long userId = context.requireUserId();
    BusinessUserProfile profile = resolveUserProfile(userId);
    if (profile.hasGlobalRole(CanonicalRole.SUPERADMIN)) {
      return null;
    }
    return context.outletIds();
  }

  // --- Finance domain ---

  public boolean canWriteFinance(RequestUserContext context) {
    if (context.internalService()) {
      return true;
    }
    long userId = context.requireUserId();
    BusinessUserProfile profile = resolveUserProfile(userId);
    if (profile.hasGlobalRole(CanonicalRole.SUPERADMIN)) {
      return true;
    }
    return profile.canonicalRoles().contains(CanonicalRole.FINANCE)
        || profile.canonicalRoles().contains(CanonicalRole.OUTLET_MANAGER);
  }

  public boolean canReadFinance(RequestUserContext context) {
    if (context.internalService()) {
      return true;
    }
    long userId = context.requireUserId();
    BusinessUserProfile profile = resolveUserProfile(userId);
    if (profile.hasGlobalRole(CanonicalRole.SUPERADMIN)) {
      return true;
    }
    return profile.canonicalRoles().contains(CanonicalRole.FINANCE)
        || profile.canonicalRoles().contains(CanonicalRole.REGION_MANAGER)
        || profile.canonicalRoles().contains(CanonicalRole.OUTLET_MANAGER);
  }

  public Set<Long> resolveFinanceReadableOutletIds(RequestUserContext context) {
    if (context.internalService()) {
      return null;
    }
    long userId = context.requireUserId();
    BusinessUserProfile profile = resolveUserProfile(userId);
    if (profile.hasGlobalRole(CanonicalRole.SUPERADMIN)) {
      return null;
    }
    LinkedHashSet<Long> result = new LinkedHashSet<>();
    result.addAll(profile.outletsForRole(CanonicalRole.FINANCE));
    result.addAll(profile.outletsForRole(CanonicalRole.REGION_MANAGER));
    result.addAll(profile.outletsForRole(CanonicalRole.OUTLET_MANAGER));
    return result.isEmpty() ? null : Set.copyOf(result);
  }

  // --- Audit domain ---

  public boolean canReadAudit(RequestUserContext context) {
    if (context.internalService()) {
      return true;
    }
    long userId = context.requireUserId();
    BusinessUserProfile profile = resolveUserProfile(userId);
    if (profile.hasGlobalRole(CanonicalRole.SUPERADMIN)) {
      return true;
    }
    return profile.canonicalRoles().contains(CanonicalRole.ADMIN)
        || profile.canonicalRoles().contains(CanonicalRole.REGION_MANAGER);
  }

  // --- Report domain ---

  public boolean canReadReport(RequestUserContext context, long outletId) {
    if (context.internalService()) {
      return true;
    }
    long userId = context.requireUserId();
    BusinessUserProfile profile = resolveUserProfile(userId);
    if (profile.hasGlobalRole(CanonicalRole.SUPERADMIN)) {
      return true;
    }
    if (profile.hasRoleForOutlet(CanonicalRole.REGION_MANAGER, outletId)
        || profile.hasRoleForOutlet(CanonicalRole.OUTLET_MANAGER, outletId)
        || profile.hasRoleForOutlet(CanonicalRole.FINANCE, outletId)) {
      return true;
    }
    return context.outletIds().contains(outletId);
  }

  private boolean canAssignRoleAtOutlet(BusinessUserProfile profile, CanonicalRole targetRole, long outletId) {
    for (BusinessScopeAssignment assignment : profile.assignments()) {
      if (assignment.role() != CanonicalRole.ADMIN || !assignment.outletIds().contains(outletId)) {
        continue;
      }
      if (assignment.scopeType() == ScopeType.OUTLET && OUTLET_ADMIN_ASSIGNABLE.contains(targetRole)) {
        return true;
      }
      if (assignment.scopeType() == ScopeType.REGION && REGION_ADMIN_ASSIGNABLE.contains(targetRole)) {
        return true;
      }
    }
    return false;
  }

  private void addOutletAssignments(
      List<BusinessScopeAssignment> assignments,
      CanonicalRole canonicalRole,
      Set<Long> outletIds,
      Map<CanonicalRole, Map<Long, Set<String>>> sourcesByRoleAndOutlet
  ) {
    if (outletIds.isEmpty()) {
      return;
    }
    List<Long> orderedOutletIds = outletIds.stream().sorted().toList();
    for (Long outletId : orderedOutletIds) {
      OrgScopeRepository.OutletScope outletScope = orgScopeRepository.findOutletScope(outletId)
          .orElse(new OrgScopeRepository.OutletScope(outletId, 0L, Long.toString(outletId), null));
      assignments.add(new BusinessScopeAssignment(
          canonicalRole,
          ScopeType.OUTLET,
          outletId,
          outletScope.outletCode(),
          Set.of(outletId),
          collectSourceRoleCodes(sourcesByRoleAndOutlet.get(canonicalRole), Set.of(outletId))
      ));
    }
  }

  private Set<String> collectSourceRoleCodes(Map<Long, Set<String>> sourceRoleCodesByOutlet, Set<Long> outletIds) {
    if (sourceRoleCodesByOutlet == null || sourceRoleCodesByOutlet.isEmpty()) {
      return Set.of();
    }
    LinkedHashSet<String> sourceRoleCodes = new LinkedHashSet<>();
    outletIds.forEach(outletId -> sourceRoleCodes.addAll(sourceRoleCodesByOutlet.getOrDefault(outletId, Set.of())));
    return Set.copyOf(sourceRoleCodes);
  }
}
