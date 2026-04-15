package com.fern.services.hr.application;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.AuthorizationPolicyService;
import com.dorabets.common.spring.auth.BusinessScopeAssignment;
import com.dorabets.common.spring.auth.BusinessUserProfile;
import com.dorabets.common.spring.auth.CanonicalRole;
import com.dorabets.common.spring.auth.ScopeType;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.dorabets.common.spring.web.PagedResult;
import com.dorabets.common.spring.web.QueryConventions;
import com.fern.services.hr.api.EmployeeContractDto;
import com.fern.services.hr.infrastructure.EmployeeContractRepository;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import java.time.LocalDate;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class EmployeeContractService {

  private final EmployeeContractRepository contractRepository;
  private final SnowflakeIdGenerator idGenerator;
  private final AuthorizationPolicyService authorizationPolicyService;

  public EmployeeContractService(
      EmployeeContractRepository contractRepository,
      SnowflakeIdGenerator idGenerator,
      AuthorizationPolicyService authorizationPolicyService
  ) {
    this.contractRepository = contractRepository;
    this.idGenerator = idGenerator;
    this.authorizationPolicyService = authorizationPolicyService;
  }

  @Transactional
  public EmployeeContractDto createContract(EmployeeContractDto.Create request) {
    requireContractWriteAccess(request.userId(), request.regionCode());
    validateDates(request.startDate(), request.endDate());
    long contractId = idGenerator.generateId();
    contractRepository.insert(
        contractId,
        request.userId(),
        request.employmentType().trim(),
        request.salaryType().trim(),
        request.baseSalary(),
        request.currencyCode().trim(),
        request.regionCode().trim(),
        trimToNull(request.taxCode()),
        trimToNull(request.bankAccount()),
        request.hireDate(),
        request.startDate(),
        request.endDate(),
        defaultStatus(request.status()),
        RequestUserContextHolder.get().userId()
    );
    return getContract(contractId);
  }

  public EmployeeContractDto getContract(long contractId) {
    return contractRepository.findById(contractId)
        .map(record -> {
          requireContractReadAccess(record.userId(), record.regionCode());
          return toDto(record);
        })
        .orElseThrow(() -> ServiceException.notFound("Contract not found: " + contractId));
  }

  public List<EmployeeContractDto> listContractsByUser(long userId) {
    requireContractReadAccess(userId, null);
    return contractRepository.findByUserId(userId).stream().map(this::toDto).toList();
  }

  public List<EmployeeContractDto> listActiveContracts() {
    ContractScope scope = resolveContractScope();
    return contractRepository.findActiveContracts(scope.outletIds(), scope.regionCodes()).stream()
        .map(this::toDto)
        .toList();
  }

  public PagedResult<EmployeeContractDto> listContracts(
      Long userId,
      Long outletId,
      String status,
      LocalDate startDateFrom,
      LocalDate startDateTo,
      LocalDate endDateFrom,
      LocalDate endDateTo,
      String q,
      String sortBy,
      String sortDir,
      Integer limit,
      Integer offset
  ) {
    ContractScope scope = resolveContractScope();
    if (outletId != null) {
      requireScopeOutletAccess(outletId);
    }
    return contractRepository.findContracts(
        userId,
        outletId,
        scope.outletIds(),
        scope.regionCodes(),
        status,
        startDateFrom,
        startDateTo,
        endDateFrom,
        endDateTo,
        QueryConventions.normalizeQuery(q),
        sortBy,
        sortDir,
        QueryConventions.sanitizeLimit(limit, 50, 200),
        QueryConventions.sanitizeOffset(offset)
    ).map(this::toDto);
  }

  public EmployeeContractDto getLatestActiveContract(long userId) {
    requireContractReadAccess(userId, null);
    return contractRepository.findLatestActiveByUserId(userId)
        .map(this::toDto)
        .orElseThrow(() -> ServiceException.notFound("No active contract found for user " + userId));
  }

  @Transactional
  public EmployeeContractDto updateContract(long contractId, EmployeeContractDto.Update request) {
    EmployeeContractRepository.ContractRecord existing = contractRepository.findById(contractId)
        .orElseThrow(() -> ServiceException.notFound("Contract not found: " + contractId));
    requireContractWriteAccess(existing.userId(), existing.regionCode());
    validateDates(
        request.startDate() == null ? existing.startDate() : request.startDate(),
        request.endDate() == null ? existing.endDate() : request.endDate()
    );
    contractRepository.update(
        contractId,
        trimToNull(request.employmentType()),
        trimToNull(request.salaryType()),
        request.baseSalary(),
        trimToNull(request.currencyCode()),
        trimToNull(request.regionCode()),
        trimToNull(request.taxCode()),
        trimToNull(request.bankAccount()),
        request.hireDate(),
        request.startDate(),
        request.endDate(),
        trimToNull(request.status())
    );
    return getContract(contractId);
  }

  @Transactional
  public EmployeeContractDto terminateContract(long contractId, LocalDate terminationDate) {
    EmployeeContractRepository.ContractRecord existing = contractRepository.findById(contractId)
        .orElseThrow(() -> ServiceException.notFound("Contract not found: " + contractId));
    requireContractWriteAccess(existing.userId(), existing.regionCode());
    LocalDate endDate = terminationDate == null ? LocalDate.now() : terminationDate;
    validateDates(existing.startDate(), endDate);
    contractRepository.terminate(contractId, endDate);
    return getContract(contractId);
  }

  private static void validateDates(LocalDate startDate, LocalDate endDate) {
    if (endDate != null && endDate.isBefore(startDate)) {
      throw ServiceException.badRequest("Contract endDate must be on or after startDate");
    }
  }

  private static String defaultStatus(String status) {
    String normalized = trimToNull(status);
    return normalized == null ? "draft" : normalized;
  }

  private void requireContractReadAccess(long targetUserId, String contractRegionCode) {
    RequestUserContext context = RequestUserContextHolder.get();
    if (context.internalService()) {
      return;
    }
    if (authorizationPolicyService.canManageContractForUser(context, targetUserId, contractRegionCode)) {
      return;
    }
    throw ServiceException.forbidden("HR contract scope is required");
  }

  private void requireContractWriteAccess(long targetUserId, String contractRegionCode) {
    RequestUserContext context = RequestUserContextHolder.get();
    if (context.internalService()) {
      return;
    }
    if (authorizationPolicyService.canManageContractForUser(context, targetUserId, contractRegionCode)) {
      return;
    }
    throw ServiceException.forbidden("HR contract mutation scope is required");
  }

  private void requireScopeOutletAccess(long outletId) {
    ContractScope scope = resolveContractScope();
    if (scope.regionCodes() != null && !scope.regionCodes().isEmpty()) {
      if (scope.outletIds() != null && scope.outletIds().contains(outletId)) {
        return;
      }
    }
    if (scope.outletIds() == null || scope.outletIds().contains(outletId)) {
      return;
    }
    throw ServiceException.forbidden("HR contract access denied for outlet " + outletId);
  }

  private ContractScope resolveContractScope() {
    RequestUserContext context = RequestUserContextHolder.get();
    if (context.internalService()) {
      return new ContractScope(null, null);
    }
    long userId = context.requireUserId();
    BusinessUserProfile profile = authorizationPolicyService.resolveUserProfile(userId);
    if (profile.hasGlobalRole(CanonicalRole.SUPERADMIN)) {
      return new ContractScope(null, null);
    }
    LinkedHashSet<Long> outletIds = new LinkedHashSet<>();
    outletIds.addAll(profile.outletsForRole(CanonicalRole.OUTLET_MANAGER));
    outletIds.addAll(profile.outletsForRole(CanonicalRole.HR));
    LinkedHashSet<String> regionCodes = new LinkedHashSet<>();
    for (BusinessScopeAssignment assignment : profile.assignments()) {
      if (assignment.role() == CanonicalRole.HR
          && assignment.scopeType() == ScopeType.REGION
          && assignment.scopeCode() != null) {
        regionCodes.add(assignment.scopeCode());
      }
    }
    if (outletIds.isEmpty() && regionCodes.isEmpty()) {
      throw ServiceException.forbidden("HR contract access is required");
    }
    return new ContractScope(
        outletIds.isEmpty() ? Set.of() : Set.copyOf(outletIds),
        regionCodes.isEmpty() ? Set.of() : Set.copyOf(regionCodes)
    );
  }

  private static String trimToNull(String value) {
    if (value == null) {
      return null;
    }
    String trimmed = value.trim();
    return trimmed.isEmpty() ? null : trimmed;
  }

  private EmployeeContractDto toDto(EmployeeContractRepository.ContractRecord record) {
    return new EmployeeContractDto(
        record.id(),
        record.userId(),
        record.employmentType(),
        record.salaryType(),
        record.baseSalary(),
        record.currencyCode(),
        record.regionCode(),
        record.taxCode(),
        record.bankAccount(),
        record.hireDate(),
        record.startDate(),
        record.endDate(),
        record.status(),
        record.createdByUserId(),
        record.deletedAt(),
        record.createdAt(),
        record.updatedAt()
    );
  }

  private record ContractScope(
      Set<Long> outletIds,
      Set<String> regionCodes
  ) {
  }
}
