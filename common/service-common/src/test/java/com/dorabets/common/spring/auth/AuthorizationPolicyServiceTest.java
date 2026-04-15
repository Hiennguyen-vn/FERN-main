package com.dorabets.common.spring.auth;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class AuthorizationPolicyServiceTest {

  @Mock
  private PermissionMatrixService permissionMatrixService;
  @Mock
  private OrgScopeRepository orgScopeRepository;

  private final RoleAliasResolver roleAliasResolver = new RoleAliasResolver();

  @Test
  void resolveUserProfileCollapsesRegionalAssignmentsAndMapsLegacyAliases() {
    AuthorizationPolicyService service = new AuthorizationPolicyService(
        permissionMatrixService,
        orgScopeRepository,
        roleAliasResolver
    );
    PermissionMatrix matrix = new PermissionMatrix(
        7L,
        Map.of(),
        Map.of(
            10L, Set.of("hr_manager"),
            11L, Set.of("hr"),
            20L, Set.of("cashier"),
            21L, Set.of("staff_pos"),
            30L, Set.of("regional_manager"),
            31L, Set.of("region_manager")
        )
    );
    when(orgScopeRepository.findAllActiveOutletIds()).thenReturn(Set.of(10L, 11L, 20L, 21L, 30L, 31L));
    when(orgScopeRepository.findAllRegionScopes()).thenReturn(List.of(
        new OrgScopeRepository.RegionScope(100L, "VN-HCM", Set.of(10L, 11L)),
        new OrgScopeRepository.RegionScope(200L, "VN-DN", Set.of(20L, 21L)),
        new OrgScopeRepository.RegionScope(300L, "US-NY", Set.of(30L, 31L))
    ));
    when(orgScopeRepository.findOutletScope(20L)).thenReturn(OptionalHelper.outlet(20L));
    when(orgScopeRepository.findOutletScope(21L)).thenReturn(OptionalHelper.outlet(21L));

    BusinessUserProfile profile = service.resolveUserProfile(7L, matrix);

    assertTrue(profile.hasRoleForRegion(100L, CanonicalRole.HR));
    assertTrue(profile.hasRoleForRegion(300L, CanonicalRole.REGION_MANAGER));
    assertTrue(profile.hasRoleForOutlet(CanonicalRole.STAFF, 20L));
    assertTrue(profile.hasRoleForOutlet(CanonicalRole.STAFF, 21L));
    assertEquals(Set.of(CanonicalRole.HR, CanonicalRole.STAFF, CanonicalRole.REGION_MANAGER), profile.canonicalRoles());
    assertEquals(
        4,
        profile.assignments().size(),
        "HR and region_manager should collapse to region scopes, staff should remain outlet-scoped"
    );
  }

  @Test
  void resolveGovernedOutletIdsReturnsScopedAdminOutletsOnly() {
    AuthorizationPolicyService service = new AuthorizationPolicyService(
        permissionMatrixService,
        orgScopeRepository,
        roleAliasResolver
    );
    PermissionMatrix matrix = new PermissionMatrix(
        9L,
        Map.of(10L, Set.of("auth.user.write"), 11L, Set.of("auth.user.write")),
        Map.of(10L, Set.of("admin"), 11L, Set.of("admin"))
    );
    when(permissionMatrixService.load(9L)).thenReturn(matrix);
    when(orgScopeRepository.findAllActiveOutletIds()).thenReturn(Set.of(10L, 11L, 20L));
    when(orgScopeRepository.findAllRegionScopes()).thenReturn(List.of(
        new OrgScopeRepository.RegionScope(100L, "VN-HCM", Set.of(10L, 11L)),
        new OrgScopeRepository.RegionScope(200L, "US-NY", Set.of(20L))
    ));

    Set<Long> governedOutletIds = service.resolveGovernedOutletIds(new RequestUserContext(
        9L,
        "scoped.admin",
        "sess-9",
        Set.of("admin"),
        Set.of("auth.user.write"),
        Set.of(10L, 11L),
        true,
        false,
        null
    ));

    assertEquals(Set.of(10L, 11L), governedOutletIds);
  }

  private static final class OptionalHelper {

    private OptionalHelper() {
    }

    private static java.util.Optional<OrgScopeRepository.OutletScope> outlet(long outletId) {
      return java.util.Optional.of(new OrgScopeRepository.OutletScope(
          outletId,
          0L,
          "OUTLET-" + outletId,
          null
      ));
    }
  }
}
