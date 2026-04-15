package com.dorabets.common.spring.auth;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * Comprehensive business rule tests for domain-level authorization policy.
 *
 * Region VN-HCM has outlets 10, 11.
 * Region US-NY has outlets 20, 21.
 *
 * Each nested class exercises one canonical role across all domain capabilities.
 */
@ExtendWith(MockitoExtension.class)
class AuthorizationPolicyDomainAccessTest {

  private static final long REGION_HCM_ID = 100L;
  private static final long REGION_NY_ID = 200L;
  private static final long OUTLET_HCM_1 = 10L;
  private static final long OUTLET_HCM_2 = 11L;
  private static final long OUTLET_NY_1 = 20L;
  private static final long OUTLET_NY_2 = 21L;

  @Mock
  private PermissionMatrixService permissionMatrixService;
  @Mock
  private OrgScopeRepository orgScopeRepository;

  private final RoleAliasResolver roleAliasResolver = new RoleAliasResolver();
  private AuthorizationPolicyService policy;

  @BeforeEach
  void setUp() {
    policy = new AuthorizationPolicyService(permissionMatrixService, orgScopeRepository, roleAliasResolver);
  }

  private void setupOrgScopes() {
    when(orgScopeRepository.findAllActiveOutletIds())
        .thenReturn(Set.of(OUTLET_HCM_1, OUTLET_HCM_2, OUTLET_NY_1, OUTLET_NY_2));
    when(orgScopeRepository.findAllRegionScopes()).thenReturn(List.of(
        new OrgScopeRepository.RegionScope(REGION_HCM_ID, "VN-HCM", Set.of(OUTLET_HCM_1, OUTLET_HCM_2)),
        new OrgScopeRepository.RegionScope(REGION_NY_ID, "US-NY", Set.of(OUTLET_NY_1, OUTLET_NY_2))
    ));
  }

  private void loadMatrix(long userId, Map<Long, Set<String>> permissions, Map<Long, Set<String>> roles) {
    PermissionMatrix matrix = new PermissionMatrix(userId, permissions, roles);
    when(permissionMatrixService.load(userId)).thenReturn(matrix);
  }

  private RequestUserContext ctx(long userId, Set<String> roles, Set<String> permissions, Set<Long> outletIds) {
    return new RequestUserContext(userId, "test-user", "sess", roles, permissions, outletIds, true, false, null);
  }

  private RequestUserContext internalCtx() {
    return new RequestUserContext(null, null, null, Set.of(), Set.of(), Set.of(), false, true, "test-service");
  }

  // =========================================================================
  // superadmin — global bypass across all domains
  // =========================================================================
  @Nested
  class SuperadminGlobalBypass {

    private RequestUserContext superadminCtx;

    @BeforeEach
    void setUp() {
      setupOrgScopes();
      loadMatrix(1L, Map.of(), Map.of(
          OUTLET_HCM_1, Set.of("superadmin"),
          OUTLET_HCM_2, Set.of("superadmin"),
          OUTLET_NY_1, Set.of("superadmin"),
          OUTLET_NY_2, Set.of("superadmin")
      ));
      superadminCtx = ctx(1L, Set.of("superadmin"), Set.of(), Set.of(OUTLET_HCM_1, OUTLET_HCM_2, OUTLET_NY_1, OUTLET_NY_2));
    }

    @Test void orgAdministrativeAccess() { assertTrue(policy.hasAdministrativeOrgAccess(superadminCtx)); }
    @Test void orgMutation() { assertTrue(policy.canMutateOrg(superadminCtx)); }
    @Test void catalogMutation() { assertTrue(policy.canMutateCatalog(superadminCtx)); }
    @Test void catalogReadAnyOutlet() { assertTrue(policy.canReadCatalogForOutlet(superadminCtx, OUTLET_NY_1)); }
    @Test void salesWrite() { assertTrue(policy.canWriteSales(superadminCtx)); }
    @Test void salesWriteForOutlet() { assertTrue(policy.canWriteSalesForOutlet(superadminCtx, OUTLET_NY_1)); }
    @Test void salesReadableReturnsNull() { assertNull(policy.resolveSalesReadableOutletIds(superadminCtx)); }
    @Test void procurementWrite() { assertTrue(policy.canWriteProcurement(superadminCtx, OUTLET_NY_1)); }
    @Test void procurementApprove() { assertTrue(policy.canApproveProcurement(superadminCtx, OUTLET_HCM_1)); }
    @Test void procurementRead() { assertTrue(policy.canReadProcurement(superadminCtx, OUTLET_HCM_1)); }
    @Test void procurementReadableReturnsNull() { assertNull(policy.resolveProcurementReadableOutletIds(superadminCtx)); }
    @Test void inventoryWrite() { assertTrue(policy.canWriteInventory(superadminCtx, OUTLET_HCM_1)); }
    @Test void inventoryReadableReturnsNull() { assertNull(policy.resolveInventoryReadableOutletIds(superadminCtx)); }
    @Test void financeWrite() { assertTrue(policy.canWriteFinance(superadminCtx)); }
    @Test void financeRead() { assertTrue(policy.canReadFinance(superadminCtx)); }
    @Test void financeReadableReturnsNull() { assertNull(policy.resolveFinanceReadableOutletIds(superadminCtx)); }
    @Test void auditRead() { assertTrue(policy.canReadAudit(superadminCtx)); }
    @Test void reportRead() { assertTrue(policy.canReadReport(superadminCtx, OUTLET_NY_2)); }
    @Test void payrollPrepare() { assertTrue(policy.canPreparePayroll(superadminCtx, REGION_HCM_ID)); }
    @Test void payrollApprove() { assertTrue(policy.canApprovePayroll(superadminCtx, REGION_NY_ID)); }
    @Test void hrSchedule() { assertTrue(policy.canManageHrSchedule(superadminCtx, OUTLET_HCM_1, true)); }
  }

  // =========================================================================
  // admin — scoped governance only (org mutation, audit read)
  // =========================================================================
  @Nested
  class AdminScopedGovernance {

    private RequestUserContext adminHcmCtx;

    @BeforeEach
    void setUp() {
      setupOrgScopes();
      loadMatrix(2L, Map.of(), Map.of(
          OUTLET_HCM_1, Set.of("admin"),
          OUTLET_HCM_2, Set.of("admin")
      ));
      adminHcmCtx = ctx(2L, Set.of("admin"), Set.of(), Set.of(OUTLET_HCM_1, OUTLET_HCM_2));
    }

    // Allowed
    @Test void orgAdministrativeAccess() { assertTrue(policy.hasAdministrativeOrgAccess(adminHcmCtx)); }
    @Test void orgMutation() { assertTrue(policy.canMutateOrg(adminHcmCtx)); }
    @Test void auditRead() { assertTrue(policy.canReadAudit(adminHcmCtx)); }

    // Denied — admin is governance-only, not business operations
    @Test void catalogMutationDenied() { assertFalse(policy.canMutateCatalog(adminHcmCtx)); }
    @Test void salesWriteDenied() { assertFalse(policy.canWriteSales(adminHcmCtx)); }
    @Test void salesWriteForOutletDenied() { assertFalse(policy.canWriteSalesForOutlet(adminHcmCtx, OUTLET_HCM_1)); }
    @Test void procurementWriteDenied() { assertFalse(policy.canWriteProcurement(adminHcmCtx, OUTLET_HCM_1)); }
    @Test void procurementApproveDenied() { assertFalse(policy.canApproveProcurement(adminHcmCtx, OUTLET_HCM_1)); }
    @Test void inventoryWriteDenied() { assertFalse(policy.canWriteInventory(adminHcmCtx, OUTLET_HCM_1)); }
    @Test void financeWriteDenied() { assertFalse(policy.canWriteFinance(adminHcmCtx)); }
    @Test void financeReadDenied() { assertFalse(policy.canReadFinance(adminHcmCtx)); }
    @Test void reportReadOutsideScopeDenied() { assertFalse(policy.canReadReport(adminHcmCtx, OUTLET_NY_1)); }
    @Test void payrollPrepareDenied() { assertFalse(policy.canPreparePayroll(adminHcmCtx, REGION_HCM_ID)); }
    @Test void payrollApproveDenied() { assertFalse(policy.canApprovePayroll(adminHcmCtx, REGION_HCM_ID)); }

    // Scoped read — admin can read catalog for own outlets via context.outletIds
    @Test void catalogReadOwnOutlet() { assertTrue(policy.canReadCatalogForOutlet(adminHcmCtx, OUTLET_HCM_1)); }
    @Test void catalogReadOutsideScope() { assertFalse(policy.canReadCatalogForOutlet(adminHcmCtx, OUTLET_NY_1)); }

    // Outlet membership still allows report read for own outlet
    @Test void reportReadOwnOutlet() { assertTrue(policy.canReadReport(adminHcmCtx, OUTLET_HCM_1)); }
  }

  // =========================================================================
  // region_manager — region-scoped read (org, sales, reports, audit)
  // =========================================================================
  @Nested
  class RegionManagerScopedRead {

    private RequestUserContext rmHcmCtx;

    @BeforeEach
    void setUp() {
      setupOrgScopes();
      loadMatrix(3L, Map.of(), Map.of(
          OUTLET_HCM_1, Set.of("region_manager"),
          OUTLET_HCM_2, Set.of("region_manager")
      ));
      rmHcmCtx = ctx(3L, Set.of("region_manager"), Set.of(), Set.of(OUTLET_HCM_1, OUTLET_HCM_2));
    }

    // Allowed — read access within region
    @Test void orgAdministrativeAccess() { assertTrue(policy.hasAdministrativeOrgAccess(rmHcmCtx)); }
    @Test void auditRead() { assertTrue(policy.canReadAudit(rmHcmCtx)); }
    @Test void financeRead() { assertTrue(policy.canReadFinance(rmHcmCtx)); }
    @Test void reportReadOwnRegion() { assertTrue(policy.canReadReport(rmHcmCtx, OUTLET_HCM_1)); }
    @Test void catalogReadOwnRegion() { assertTrue(policy.canReadCatalogForOutlet(rmHcmCtx, OUTLET_HCM_1)); }

    // Sales readable scoped to region outlets
    @Test void salesReadableScopedToRegion() {
      Set<Long> readable = policy.resolveSalesReadableOutletIds(rmHcmCtx);
      assertNotNull(readable);
      assertTrue(readable.contains(OUTLET_HCM_1));
      assertTrue(readable.contains(OUTLET_HCM_2));
      assertFalse(readable.contains(OUTLET_NY_1));
    }

    // Denied — no mutation, no write operations
    @Test void orgMutationDenied() { assertFalse(policy.canMutateOrg(rmHcmCtx)); }
    @Test void catalogMutationDenied() { assertFalse(policy.canMutateCatalog(rmHcmCtx)); }
    @Test void salesWriteDenied() { assertFalse(policy.canWriteSales(rmHcmCtx)); }
    @Test void salesWriteForOutletDenied() { assertFalse(policy.canWriteSalesForOutlet(rmHcmCtx, OUTLET_HCM_1)); }
    @Test void procurementWriteDenied() { assertFalse(policy.canWriteProcurement(rmHcmCtx, OUTLET_HCM_1)); }
    @Test void inventoryWriteDenied() { assertFalse(policy.canWriteInventory(rmHcmCtx, OUTLET_HCM_1)); }
    @Test void financeWriteDenied() { assertFalse(policy.canWriteFinance(rmHcmCtx)); }
    @Test void payrollPrepareDenied() { assertFalse(policy.canPreparePayroll(rmHcmCtx, REGION_HCM_ID)); }
    @Test void payrollApproveDenied() { assertFalse(policy.canApprovePayroll(rmHcmCtx, REGION_HCM_ID)); }

    // Outside region
    @Test void reportReadOutsideRegion() { assertFalse(policy.canReadReport(rmHcmCtx, OUTLET_NY_1)); }
    @Test void catalogReadOutsideRegion() { assertFalse(policy.canReadCatalogForOutlet(rmHcmCtx, OUTLET_NY_1)); }
  }

  // =========================================================================
  // outlet_manager — outlet-scoped operations
  // =========================================================================
  @Nested
  class OutletManagerScopedOps {

    private RequestUserContext omCtx;

    @BeforeEach
    void setUp() {
      setupOrgScopes();
      loadMatrix(4L, Map.of(), Map.of(
          OUTLET_HCM_1, Set.of("outlet_manager")
      ));
      when(orgScopeRepository.findOutletScope(OUTLET_HCM_1))
          .thenReturn(java.util.Optional.of(new OrgScopeRepository.OutletScope(OUTLET_HCM_1, REGION_HCM_ID, "HCM-1", null)));
      omCtx = ctx(4L, Set.of("outlet_manager"), Set.of(), Set.of(OUTLET_HCM_1));
    }

    // Allowed — outlet-scoped operations
    @Test void salesWrite() { assertTrue(policy.canWriteSales(omCtx)); }
    @Test void salesWriteForOwnOutlet() { assertTrue(policy.canWriteSalesForOutlet(omCtx, OUTLET_HCM_1)); }
    @Test void procurementWrite() { assertTrue(policy.canWriteProcurement(omCtx, OUTLET_HCM_1)); }
    @Test void procurementApprove() { assertTrue(policy.canApproveProcurement(omCtx, OUTLET_HCM_1)); }
    @Test void inventoryWrite() { assertTrue(policy.canWriteInventory(omCtx, OUTLET_HCM_1)); }
    @Test void financeWrite() { assertTrue(policy.canWriteFinance(omCtx)); }
    @Test void financeRead() { assertTrue(policy.canReadFinance(omCtx)); }
    @Test void reportReadOwnOutlet() { assertTrue(policy.canReadReport(omCtx, OUTLET_HCM_1)); }
    @Test void procurementReadOwnOutlet() { assertTrue(policy.canReadProcurement(omCtx, OUTLET_HCM_1)); }
    @Test void catalogReadOwnOutlet() { assertTrue(policy.canReadCatalogForOutlet(omCtx, OUTLET_HCM_1)); }
    @Test void hrScheduleOwnOutlet() { assertTrue(policy.canManageHrSchedule(omCtx, OUTLET_HCM_1, true)); }

    // Denied — outside own outlet
    @Test void salesWriteOtherOutlet() { assertFalse(policy.canWriteSalesForOutlet(omCtx, OUTLET_NY_1)); }
    @Test void procurementWriteOtherOutlet() { assertFalse(policy.canWriteProcurement(omCtx, OUTLET_NY_1)); }
    @Test void procurementApproveOtherOutlet() { assertFalse(policy.canApproveProcurement(omCtx, OUTLET_NY_1)); }
    @Test void inventoryWriteOtherOutlet() { assertFalse(policy.canWriteInventory(omCtx, OUTLET_NY_1)); }
    @Test void reportReadOtherOutlet() { assertFalse(policy.canReadReport(omCtx, OUTLET_NY_1)); }

    // Denied — not governance
    @Test void orgMutationDenied() { assertFalse(policy.canMutateOrg(omCtx)); }
    @Test void orgAdminAccessDenied() { assertFalse(policy.hasAdministrativeOrgAccess(omCtx)); }
    @Test void auditReadDenied() { assertFalse(policy.canReadAudit(omCtx)); }
    @Test void catalogMutationDenied() { assertFalse(policy.canMutateCatalog(omCtx)); }
    @Test void payrollPrepareDenied() { assertFalse(policy.canPreparePayroll(omCtx, REGION_HCM_ID)); }
    @Test void payrollApproveDenied() { assertFalse(policy.canApprovePayroll(omCtx, REGION_HCM_ID)); }
  }

  // =========================================================================
  // staff — outlet POS/sales only
  // =========================================================================
  @Nested
  class StaffPosOnly {

    private RequestUserContext staffCtx;

    @BeforeEach
    void setUp() {
      setupOrgScopes();
      loadMatrix(5L, Map.of(), Map.of(
          OUTLET_HCM_1, Set.of("cashier")
      ));
      when(orgScopeRepository.findOutletScope(OUTLET_HCM_1))
          .thenReturn(java.util.Optional.of(new OrgScopeRepository.OutletScope(OUTLET_HCM_1, REGION_HCM_ID, "HCM-1", null)));
      staffCtx = ctx(5L, Set.of("cashier"), Set.of(), Set.of(OUTLET_HCM_1));
    }

    // Allowed — POS/sales operations
    @Test void salesWrite() { assertTrue(policy.canWriteSales(staffCtx)); }
    @Test void salesWriteForOwnOutlet() { assertTrue(policy.canWriteSalesForOutlet(staffCtx, OUTLET_HCM_1)); }
    @Test void salesReadableScopedToOutlet() {
      Set<Long> readable = policy.resolveSalesReadableOutletIds(staffCtx);
      assertEquals(Set.of(OUTLET_HCM_1), readable);
    }

    // Denied — everything else
    @Test void salesWriteOtherOutlet() { assertFalse(policy.canWriteSalesForOutlet(staffCtx, OUTLET_NY_1)); }
    @Test void orgAdminDenied() { assertFalse(policy.hasAdministrativeOrgAccess(staffCtx)); }
    @Test void orgMutationDenied() { assertFalse(policy.canMutateOrg(staffCtx)); }
    @Test void catalogMutationDenied() { assertFalse(policy.canMutateCatalog(staffCtx)); }
    @Test void procurementWriteDenied() { assertFalse(policy.canWriteProcurement(staffCtx, OUTLET_HCM_1)); }
    @Test void procurementApproveDenied() { assertFalse(policy.canApproveProcurement(staffCtx, OUTLET_HCM_1)); }
    @Test void inventoryWriteDenied() { assertFalse(policy.canWriteInventory(staffCtx, OUTLET_HCM_1)); }
    @Test void financeWriteDenied() { assertFalse(policy.canWriteFinance(staffCtx)); }
    @Test void financeReadDenied() { assertFalse(policy.canReadFinance(staffCtx)); }
    @Test void auditReadDenied() { assertFalse(policy.canReadAudit(staffCtx)); }
    @Test void payrollPrepareDenied() { assertFalse(policy.canPreparePayroll(staffCtx, REGION_HCM_ID)); }
    @Test void payrollApproveDenied() { assertFalse(policy.canApprovePayroll(staffCtx, REGION_HCM_ID)); }

    // Staff can still read catalog/reports for own outlet via outlet membership
    @Test void catalogReadOwnOutlet() { assertTrue(policy.canReadCatalogForOutlet(staffCtx, OUTLET_HCM_1)); }
    @Test void reportReadOwnOutlet() { assertTrue(policy.canReadReport(staffCtx, OUTLET_HCM_1)); }
    @Test void catalogReadOtherOutlet() { assertFalse(policy.canReadCatalogForOutlet(staffCtx, OUTLET_NY_1)); }
  }

  // =========================================================================
  // product_manager — catalog mutation, region-scoped
  // =========================================================================
  @Nested
  class ProductManagerCatalog {

    private RequestUserContext pmCtx;

    @BeforeEach
    void setUp() {
      setupOrgScopes();
      loadMatrix(6L, Map.of(), Map.of(
          OUTLET_HCM_1, Set.of("product_manager"),
          OUTLET_HCM_2, Set.of("product_manager")
      ));
      pmCtx = ctx(6L, Set.of("product_manager"), Set.of(), Set.of(OUTLET_HCM_1, OUTLET_HCM_2));
    }

    // Allowed — catalog operations
    @Test void catalogMutation() { assertTrue(policy.canMutateCatalog(pmCtx)); }
    @Test void catalogReadOwnRegion() { assertTrue(policy.canReadCatalogForOutlet(pmCtx, OUTLET_HCM_1)); }
    @Test void catalogReadOwnRegion2() { assertTrue(policy.canReadCatalogForOutlet(pmCtx, OUTLET_HCM_2)); }

    // Denied — outside region
    @Test void catalogReadOutsideRegion() { assertFalse(policy.canReadCatalogForOutlet(pmCtx, OUTLET_NY_1)); }

    // Denied — everything non-catalog
    @Test void orgMutationDenied() { assertFalse(policy.canMutateOrg(pmCtx)); }
    @Test void orgAdminDenied() { assertFalse(policy.hasAdministrativeOrgAccess(pmCtx)); }
    @Test void salesWriteDenied() { assertFalse(policy.canWriteSales(pmCtx)); }
    @Test void procurementWriteDenied() { assertFalse(policy.canWriteProcurement(pmCtx, OUTLET_HCM_1)); }
    @Test void inventoryWriteDenied() { assertFalse(policy.canWriteInventory(pmCtx, OUTLET_HCM_1)); }
    @Test void financeWriteDenied() { assertFalse(policy.canWriteFinance(pmCtx)); }
    @Test void financeReadDenied() { assertFalse(policy.canReadFinance(pmCtx)); }
    @Test void auditReadDenied() { assertFalse(policy.canReadAudit(pmCtx)); }
    @Test void payrollPrepareDenied() { assertFalse(policy.canPreparePayroll(pmCtx, REGION_HCM_ID)); }
    @Test void payrollApproveDenied() { assertFalse(policy.canApprovePayroll(pmCtx, REGION_HCM_ID)); }
  }

  // =========================================================================
  // procurement — procurement write in own outlet
  // =========================================================================
  @Nested
  class ProcurementOutletWrite {

    private RequestUserContext procCtx;

    @BeforeEach
    void setUp() {
      setupOrgScopes();
      loadMatrix(7L, Map.of(), Map.of(
          OUTLET_HCM_1, Set.of("procurement_officer")
      ));
      when(orgScopeRepository.findOutletScope(OUTLET_HCM_1))
          .thenReturn(java.util.Optional.of(new OrgScopeRepository.OutletScope(OUTLET_HCM_1, REGION_HCM_ID, "HCM-1", null)));
      procCtx = ctx(7L, Set.of("procurement_officer"), Set.of(), Set.of(OUTLET_HCM_1));
    }

    // Allowed — procurement operations in own outlet
    @Test void procurementWrite() { assertTrue(policy.canWriteProcurement(procCtx, OUTLET_HCM_1)); }
    @Test void procurementRead() { assertTrue(policy.canReadProcurement(procCtx, OUTLET_HCM_1)); }
    @Test void procurementReadableIncludesOwnOutlet() {
      Set<Long> readable = policy.resolveProcurementReadableOutletIds(procCtx);
      assertTrue(readable.contains(OUTLET_HCM_1));
    }

    // Denied — procurement approve (only outlet_manager can approve)
    @Test void procurementApproveDenied() { assertFalse(policy.canApproveProcurement(procCtx, OUTLET_HCM_1)); }

    // Denied — outside outlet
    @Test void procurementWriteOtherOutlet() { assertFalse(policy.canWriteProcurement(procCtx, OUTLET_NY_1)); }

    // Denied — everything else
    @Test void orgMutationDenied() { assertFalse(policy.canMutateOrg(procCtx)); }
    @Test void catalogMutationDenied() { assertFalse(policy.canMutateCatalog(procCtx)); }
    @Test void salesWriteDenied() { assertFalse(policy.canWriteSales(procCtx)); }
    @Test void inventoryWriteDenied() { assertFalse(policy.canWriteInventory(procCtx, OUTLET_HCM_1)); }
    @Test void financeWriteDenied() { assertFalse(policy.canWriteFinance(procCtx)); }
    @Test void financeReadDenied() { assertFalse(policy.canReadFinance(procCtx)); }
    @Test void auditReadDenied() { assertFalse(policy.canReadAudit(procCtx)); }
  }

  // =========================================================================
  // finance — finance read/write, report access, payroll approve
  // =========================================================================
  @Nested
  class FinanceRegionScoped {

    private RequestUserContext finCtx;

    @BeforeEach
    void setUp() {
      setupOrgScopes();
      loadMatrix(8L, Map.of(), Map.of(
          OUTLET_HCM_1, Set.of("finance"),
          OUTLET_HCM_2, Set.of("finance")
      ));
      finCtx = ctx(8L, Set.of("finance"), Set.of(), Set.of(OUTLET_HCM_1, OUTLET_HCM_2));
    }

    // Allowed — finance operations
    @Test void financeWrite() { assertTrue(policy.canWriteFinance(finCtx)); }
    @Test void financeRead() { assertTrue(policy.canReadFinance(finCtx)); }
    @Test void reportReadOwnRegion() { assertTrue(policy.canReadReport(finCtx, OUTLET_HCM_1)); }
    @Test void reportReadOwnRegion2() { assertTrue(policy.canReadReport(finCtx, OUTLET_HCM_2)); }
    @Test void payrollApproveOwnRegion() { assertTrue(policy.canApprovePayroll(finCtx, REGION_HCM_ID)); }

    // Finance readable outlets
    @Test void financeReadableIncludesRegionOutlets() {
      Set<Long> readable = policy.resolveFinanceReadableOutletIds(finCtx);
      assertNotNull(readable);
      assertTrue(readable.contains(OUTLET_HCM_1));
      assertTrue(readable.contains(OUTLET_HCM_2));
    }

    // Denied — outside region
    @Test void reportReadOutsideRegion() { assertFalse(policy.canReadReport(finCtx, OUTLET_NY_1)); }
    @Test void payrollApproveOtherRegion() { assertFalse(policy.canApprovePayroll(finCtx, REGION_NY_ID)); }

    // Denied — finance does not prepare payroll (that's HR)
    @Test void payrollPrepareDenied() { assertFalse(policy.canPreparePayroll(finCtx, REGION_HCM_ID)); }

    // Denied — everything non-finance
    @Test void orgMutationDenied() { assertFalse(policy.canMutateOrg(finCtx)); }
    @Test void orgAdminDenied() { assertFalse(policy.hasAdministrativeOrgAccess(finCtx)); }
    @Test void catalogMutationDenied() { assertFalse(policy.canMutateCatalog(finCtx)); }
    @Test void salesWriteDenied() { assertFalse(policy.canWriteSales(finCtx)); }
    @Test void procurementWriteDenied() { assertFalse(policy.canWriteProcurement(finCtx, OUTLET_HCM_1)); }
    @Test void inventoryWriteDenied() { assertFalse(policy.canWriteInventory(finCtx, OUTLET_HCM_1)); }
    @Test void auditReadDenied() { assertFalse(policy.canReadAudit(finCtx)); }
  }

  // =========================================================================
  // hr — payroll prepare, schedule, contract management
  // =========================================================================
  @Nested
  class HrRegionScoped {

    private RequestUserContext hrCtx;

    @BeforeEach
    void setUp() {
      setupOrgScopes();
      loadMatrix(9L, Map.of(), Map.of(
          OUTLET_HCM_1, Set.of("hr"),
          OUTLET_HCM_2, Set.of("hr")
      ));
      hrCtx = ctx(9L, Set.of("hr"), Set.of(), Set.of(OUTLET_HCM_1, OUTLET_HCM_2));
    }

    // Allowed — HR operations
    @Test void payrollPrepare() { assertTrue(policy.canPreparePayroll(hrCtx, REGION_HCM_ID)); }
    @Test void hrScheduleOwnRegion() { assertTrue(policy.canManageHrSchedule(hrCtx, OUTLET_HCM_1, true)); }
    @Test void hrScheduleOwnRegion2() { assertTrue(policy.canManageHrSchedule(hrCtx, OUTLET_HCM_2, true)); }

    // Denied — outside region
    @Test void payrollPrepareOtherRegion() { assertFalse(policy.canPreparePayroll(hrCtx, REGION_NY_ID)); }
    @Test void hrScheduleOtherRegion() { assertFalse(policy.canManageHrSchedule(hrCtx, OUTLET_NY_1, true)); }

    // Denied — HR does not approve payroll
    @Test void payrollApproveDenied() { assertFalse(policy.canApprovePayroll(hrCtx, REGION_HCM_ID)); }

    // Denied — non-HR operations
    @Test void orgMutationDenied() { assertFalse(policy.canMutateOrg(hrCtx)); }
    @Test void catalogMutationDenied() { assertFalse(policy.canMutateCatalog(hrCtx)); }
    @Test void salesWriteDenied() { assertFalse(policy.canWriteSales(hrCtx)); }
    @Test void procurementWriteDenied() { assertFalse(policy.canWriteProcurement(hrCtx, OUTLET_HCM_1)); }
    @Test void inventoryWriteDenied() { assertFalse(policy.canWriteInventory(hrCtx, OUTLET_HCM_1)); }
    @Test void financeWriteDenied() { assertFalse(policy.canWriteFinance(hrCtx)); }
    @Test void financeReadDenied() { assertFalse(policy.canReadFinance(hrCtx)); }
    @Test void auditReadDenied() { assertFalse(policy.canReadAudit(hrCtx)); }
  }

  // =========================================================================
  // kitchen_staff — no business operations, only outlet membership
  // =========================================================================
  @Nested
  class KitchenStaffMinimal {

    private RequestUserContext ksCtx;

    @BeforeEach
    void setUp() {
      setupOrgScopes();
      loadMatrix(10L, Map.of(), Map.of(
          OUTLET_HCM_1, Set.of("kitchen_staff")
      ));
      when(orgScopeRepository.findOutletScope(OUTLET_HCM_1))
          .thenReturn(java.util.Optional.of(new OrgScopeRepository.OutletScope(OUTLET_HCM_1, REGION_HCM_ID, "HCM-1", null)));
      ksCtx = ctx(10L, Set.of("kitchen_staff"), Set.of(), Set.of(OUTLET_HCM_1));
    }

    // All business operations denied
    @Test void salesWriteDenied() { assertFalse(policy.canWriteSales(ksCtx)); }
    @Test void catalogMutationDenied() { assertFalse(policy.canMutateCatalog(ksCtx)); }
    @Test void procurementWriteDenied() { assertFalse(policy.canWriteProcurement(ksCtx, OUTLET_HCM_1)); }
    @Test void inventoryWriteDenied() { assertFalse(policy.canWriteInventory(ksCtx, OUTLET_HCM_1)); }
    @Test void financeWriteDenied() { assertFalse(policy.canWriteFinance(ksCtx)); }
    @Test void financeReadDenied() { assertFalse(policy.canReadFinance(ksCtx)); }
    @Test void auditReadDenied() { assertFalse(policy.canReadAudit(ksCtx)); }
    @Test void orgMutationDenied() { assertFalse(policy.canMutateOrg(ksCtx)); }

    // Outlet membership allows basic read
    @Test void catalogReadOwnOutlet() { assertTrue(policy.canReadCatalogForOutlet(ksCtx, OUTLET_HCM_1)); }
    @Test void reportReadOwnOutlet() { assertTrue(policy.canReadReport(ksCtx, OUTLET_HCM_1)); }
  }

  // =========================================================================
  // Legacy alias mapping
  // =========================================================================
  @Nested
  class LegacyAliasMapping {

    @BeforeEach
    void setUp() {
      setupOrgScopes();
    }

    @Test
    void cashierMapsToStaffWithSalesAccess() {
      loadMatrix(50L, Map.of(), Map.of(OUTLET_HCM_1, Set.of("cashier")));
      when(orgScopeRepository.findOutletScope(OUTLET_HCM_1))
          .thenReturn(java.util.Optional.of(new OrgScopeRepository.OutletScope(OUTLET_HCM_1, REGION_HCM_ID, "HCM-1", null)));
      RequestUserContext ctx = ctx(50L, Set.of("cashier"), Set.of(), Set.of(OUTLET_HCM_1));
      assertTrue(policy.canWriteSales(ctx));
      assertTrue(policy.canWriteSalesForOutlet(ctx, OUTLET_HCM_1));
    }

    @Test
    void staffPosMapsToStaffWithSalesAccess() {
      loadMatrix(51L, Map.of(), Map.of(OUTLET_HCM_1, Set.of("staff_pos")));
      when(orgScopeRepository.findOutletScope(OUTLET_HCM_1))
          .thenReturn(java.util.Optional.of(new OrgScopeRepository.OutletScope(OUTLET_HCM_1, REGION_HCM_ID, "HCM-1", null)));
      RequestUserContext ctx = ctx(51L, Set.of("staff_pos"), Set.of(), Set.of(OUTLET_HCM_1));
      assertTrue(policy.canWriteSales(ctx));
    }

    @Test
    void procurementOfficerMapsToProcurement() {
      loadMatrix(52L, Map.of(), Map.of(OUTLET_HCM_1, Set.of("procurement_officer")));
      when(orgScopeRepository.findOutletScope(OUTLET_HCM_1))
          .thenReturn(java.util.Optional.of(new OrgScopeRepository.OutletScope(OUTLET_HCM_1, REGION_HCM_ID, "HCM-1", null)));
      RequestUserContext ctx = ctx(52L, Set.of("procurement_officer"), Set.of(), Set.of(OUTLET_HCM_1));
      assertTrue(policy.canWriteProcurement(ctx, OUTLET_HCM_1));
    }

    @Test
    void financeManagerMapsToFinance() {
      loadMatrix(53L, Map.of(), Map.of(OUTLET_HCM_1, Set.of("finance_manager"), OUTLET_HCM_2, Set.of("finance_manager")));
      RequestUserContext ctx = ctx(53L, Set.of("finance_manager"), Set.of(), Set.of(OUTLET_HCM_1, OUTLET_HCM_2));
      assertTrue(policy.canWriteFinance(ctx));
      assertTrue(policy.canReadFinance(ctx));
    }

    @Test
    void hrManagerMapsToHr() {
      loadMatrix(54L, Map.of(), Map.of(OUTLET_HCM_1, Set.of("hr_manager"), OUTLET_HCM_2, Set.of("hr_manager")));
      RequestUserContext ctx = ctx(54L, Set.of("hr_manager"), Set.of(), Set.of(OUTLET_HCM_1, OUTLET_HCM_2));
      assertTrue(policy.canPreparePayroll(ctx, REGION_HCM_ID));
    }

    @Test
    void regionalManagerMapsToRegionManager() {
      loadMatrix(55L, Map.of(), Map.of(OUTLET_HCM_1, Set.of("regional_manager"), OUTLET_HCM_2, Set.of("regional_manager")));
      RequestUserContext ctx = ctx(55L, Set.of("regional_manager"), Set.of(), Set.of(OUTLET_HCM_1, OUTLET_HCM_2));
      assertTrue(policy.hasAdministrativeOrgAccess(ctx));
      assertTrue(policy.canReadAudit(ctx));
    }

    @Test
    void systemAdminMapsToAdmin() {
      loadMatrix(56L, Map.of(), Map.of(OUTLET_HCM_1, Set.of("system_admin")));
      when(orgScopeRepository.findOutletScope(OUTLET_HCM_1))
          .thenReturn(java.util.Optional.of(new OrgScopeRepository.OutletScope(OUTLET_HCM_1, REGION_HCM_ID, "HCM-1", null)));
      RequestUserContext ctx = ctx(56L, Set.of("system_admin"), Set.of(), Set.of(OUTLET_HCM_1));
      assertTrue(policy.hasAdministrativeOrgAccess(ctx));
      assertTrue(policy.canMutateOrg(ctx));
      assertTrue(policy.canReadAudit(ctx));
      // system_admin mapped to admin → no business ops
      assertFalse(policy.canWriteSales(ctx));
    }
  }

  // =========================================================================
  // Internal service bypass
  // =========================================================================
  @Nested
  class InternalServiceBypass {

    @Test void orgAdmin() { assertTrue(policy.hasAdministrativeOrgAccess(internalCtx())); }
    @Test void orgMutate() { assertTrue(policy.canMutateOrg(internalCtx())); }
    @Test void catalogMutate() { assertTrue(policy.canMutateCatalog(internalCtx())); }
    @Test void catalogRead() { assertTrue(policy.canReadCatalogForOutlet(internalCtx(), 999L)); }
    @Test void salesWrite() { assertTrue(policy.canWriteSales(internalCtx())); }
    @Test void salesWriteOutlet() { assertTrue(policy.canWriteSalesForOutlet(internalCtx(), 999L)); }
    @Test void salesReadable() { assertNull(policy.resolveSalesReadableOutletIds(internalCtx())); }
    @Test void procurementWrite() { assertTrue(policy.canWriteProcurement(internalCtx(), 999L)); }
    @Test void procurementApprove() { assertTrue(policy.canApproveProcurement(internalCtx(), 999L)); }
    @Test void procurementRead() { assertTrue(policy.canReadProcurement(internalCtx(), 999L)); }
    @Test void procurementReadable() { assertNull(policy.resolveProcurementReadableOutletIds(internalCtx())); }
    @Test void inventoryWrite() { assertTrue(policy.canWriteInventory(internalCtx(), 999L)); }
    @Test void inventoryReadable() { assertNull(policy.resolveInventoryReadableOutletIds(internalCtx())); }
    @Test void financeWrite() { assertTrue(policy.canWriteFinance(internalCtx())); }
    @Test void financeRead() { assertTrue(policy.canReadFinance(internalCtx())); }
    @Test void financeReadable() { assertNull(policy.resolveFinanceReadableOutletIds(internalCtx())); }
    @Test void auditRead() { assertTrue(policy.canReadAudit(internalCtx())); }
    @Test void reportRead() { assertTrue(policy.canReadReport(internalCtx(), 999L)); }
    @Test void payrollPrepare() { assertTrue(policy.canPreparePayroll(internalCtx(), 999L)); }
    @Test void payrollApprove() { assertTrue(policy.canApprovePayroll(internalCtx(), 999L)); }
    @Test void hrSchedule() { assertTrue(policy.canManageHrSchedule(internalCtx(), 999L, true)); }
  }

  // =========================================================================
  // Cross-scope isolation
  // =========================================================================
  @Nested
  class CrossScopeIsolation {

    @BeforeEach
    void setUp() {
      setupOrgScopes();
    }

    @Test
    void adminOutletHcmCannotAccessNyAudit() {
      loadMatrix(60L, Map.of(), Map.of(OUTLET_HCM_1, Set.of("admin")));
      when(orgScopeRepository.findOutletScope(OUTLET_HCM_1))
          .thenReturn(java.util.Optional.of(new OrgScopeRepository.OutletScope(OUTLET_HCM_1, REGION_HCM_ID, "HCM-1", null)));
      RequestUserContext ctx = ctx(60L, Set.of("admin"), Set.of(), Set.of(OUTLET_HCM_1));
      // admin can read audit globally (by role)
      assertTrue(policy.canReadAudit(ctx));
      // but cannot see NY reports (outlet-scoped)
      assertFalse(policy.canReadReport(ctx, OUTLET_NY_1));
    }

    @Test
    void hrHcmCannotPreparePayrollForNy() {
      loadMatrix(61L, Map.of(), Map.of(OUTLET_HCM_1, Set.of("hr"), OUTLET_HCM_2, Set.of("hr")));
      RequestUserContext ctx = ctx(61L, Set.of("hr"), Set.of(), Set.of(OUTLET_HCM_1, OUTLET_HCM_2));
      assertTrue(policy.canPreparePayroll(ctx, REGION_HCM_ID));
      assertFalse(policy.canPreparePayroll(ctx, REGION_NY_ID));
    }

    @Test
    void financeHcmCannotApprovePayrollForNy() {
      loadMatrix(62L, Map.of(), Map.of(OUTLET_HCM_1, Set.of("finance"), OUTLET_HCM_2, Set.of("finance")));
      RequestUserContext ctx = ctx(62L, Set.of("finance"), Set.of(), Set.of(OUTLET_HCM_1, OUTLET_HCM_2));
      assertTrue(policy.canApprovePayroll(ctx, REGION_HCM_ID));
      assertFalse(policy.canApprovePayroll(ctx, REGION_NY_ID));
    }

    @Test
    void outletManagerHcm1CannotWriteInventoryForHcm2() {
      loadMatrix(63L, Map.of(), Map.of(OUTLET_HCM_1, Set.of("outlet_manager")));
      when(orgScopeRepository.findOutletScope(OUTLET_HCM_1))
          .thenReturn(java.util.Optional.of(new OrgScopeRepository.OutletScope(OUTLET_HCM_1, REGION_HCM_ID, "HCM-1", null)));
      RequestUserContext ctx = ctx(63L, Set.of("outlet_manager"), Set.of(), Set.of(OUTLET_HCM_1));
      assertTrue(policy.canWriteInventory(ctx, OUTLET_HCM_1));
      assertFalse(policy.canWriteInventory(ctx, OUTLET_HCM_2));
    }
  }
}
