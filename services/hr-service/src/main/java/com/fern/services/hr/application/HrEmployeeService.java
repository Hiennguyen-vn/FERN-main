package com.fern.services.hr.application;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.AuthorizationPolicyService;
import com.dorabets.common.spring.auth.BusinessUserProfile;
import com.dorabets.common.spring.auth.CanonicalRole;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.dorabets.common.spring.web.PagedResult;
import com.dorabets.common.spring.web.QueryConventions;
import com.fern.services.hr.api.HrEmployeeDto;
import com.fern.services.hr.infrastructure.HrEmployeeRepository;
import java.util.LinkedHashSet;
import java.util.Set;
import org.springframework.stereotype.Service;

@Service
public class HrEmployeeService {

  private final HrEmployeeRepository employeeRepository;
  private final AuthorizationPolicyService authorizationPolicyService;

  public HrEmployeeService(
      HrEmployeeRepository employeeRepository,
      AuthorizationPolicyService authorizationPolicyService
  ) {
    this.employeeRepository = employeeRepository;
    this.authorizationPolicyService = authorizationPolicyService;
  }

  public PagedResult<HrEmployeeDto> listEmployees(
      String q,
      String status,
      Long outletId,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    Set<Long> outletIds = resolveHrOutletIds(outletId);
    String normalizedQuery = QueryConventions.normalizeQuery(q);
    int safeLimit = QueryConventions.sanitizeLimit(limit, 100, 500);
    int safeOffset = QueryConventions.sanitizeOffset(offset);

    PagedResult<HrEmployeeRepository.EmployeeRecord> page =
        employeeRepository.findEmployees(normalizedQuery, status, outletIds, sortBy, sortDir, safeLimit, safeOffset);

    return page.map(this::toDto);
  }

  public HrEmployeeDto getEmployee(long userId) {
    return employeeRepository.findById(userId)
        .map(this::toDto)
        .orElseThrow(() -> ServiceException.notFound("Employee not found: " + userId));
  }

  private HrEmployeeDto toDto(HrEmployeeRepository.EmployeeRecord record) {
    HrEmployeeDto.ActiveContract activeContract = null;
    if (record.contractId() != null) {
      activeContract = new HrEmployeeDto.ActiveContract(
          record.contractId(),
          record.employmentType(),
          record.salaryType(),
          record.baseSalary(),
          record.currencyCode(),
          record.regionCode(),
          record.contractStartDate(),
          record.contractEndDate(),
          record.contractStatus()
      );
    }
    return new HrEmployeeDto(
        record.id(),
        record.username(),
        record.fullName(),
        record.employeeCode(),
        record.email(),
        record.phone(),
        record.status(),
        record.gender(),
        record.dob(),
        record.createdAt(),
        activeContract
    );
  }

  /**
   * Resolve outlet IDs accessible to the current user for HR purposes.
   * Users with HR or OUTLET_MANAGER roles can see employees in their outlets.
   * Superadmins and internal services see all employees.
   */
  private Set<Long> resolveHrOutletIds(Long requestedOutletId) {
    RequestUserContext context = RequestUserContextHolder.get();
    if (context.internalService()) {
      return requestedOutletId != null ? Set.of(requestedOutletId) : null;
    }
    long userId = context.requireUserId();
    BusinessUserProfile profile = authorizationPolicyService.resolveUserProfile(userId);
    if (profile.hasGlobalRole(CanonicalRole.SUPERADMIN)) {
      return requestedOutletId != null ? Set.of(requestedOutletId) : null;
    }

    LinkedHashSet<Long> outletIds = new LinkedHashSet<>();
    outletIds.addAll(profile.outletsForRole(CanonicalRole.HR));
    outletIds.addAll(profile.outletsForRole(CanonicalRole.OUTLET_MANAGER));
    outletIds.addAll(profile.outletsForRole(CanonicalRole.FINANCE));

    if (outletIds.isEmpty()) {
      throw ServiceException.forbidden("HR employee read access is required");
    }
    if (requestedOutletId != null) {
      if (!outletIds.contains(requestedOutletId)) {
        throw ServiceException.forbidden("HR employee access denied for outlet " + requestedOutletId);
      }
      return Set.of(requestedOutletId);
    }
    return Set.copyOf(outletIds);
  }
}
