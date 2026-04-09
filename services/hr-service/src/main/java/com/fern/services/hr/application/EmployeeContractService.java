package com.fern.services.hr.application;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.dorabets.common.spring.web.PagedResult;
import com.dorabets.common.spring.web.QueryConventions;
import com.fern.services.hr.api.EmployeeContractDto;
import com.fern.services.hr.infrastructure.EmployeeContractRepository;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import java.time.LocalDate;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class EmployeeContractService {

  private final EmployeeContractRepository contractRepository;
  private final SnowflakeIdGenerator idGenerator;

  public EmployeeContractService(
      EmployeeContractRepository contractRepository,
      SnowflakeIdGenerator idGenerator
  ) {
    this.contractRepository = contractRepository;
    this.idGenerator = idGenerator;
  }

  @Transactional
  public EmployeeContractDto createContract(EmployeeContractDto.Create request) {
    requireAdminOrInternal();
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
    requireAdminOrInternal();
    return contractRepository.findById(contractId)
        .map(this::toDto)
        .orElseThrow(() -> ServiceException.notFound("Contract not found: " + contractId));
  }

  public List<EmployeeContractDto> listContractsByUser(long userId) {
    requireAdminOrInternal();
    return contractRepository.findByUserId(userId).stream().map(this::toDto).toList();
  }

  public List<EmployeeContractDto> listActiveContracts() {
    requireAdminOrInternal();
    return contractRepository.findActiveContracts().stream().map(this::toDto).toList();
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
    requireAdminOrInternal();
    return contractRepository.findContracts(
        userId,
        outletId,
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
    requireAdminOrInternal();
    return contractRepository.findLatestActiveByUserId(userId)
        .map(this::toDto)
        .orElseThrow(() -> ServiceException.notFound("No active contract found for user " + userId));
  }

  @Transactional
  public EmployeeContractDto updateContract(long contractId, EmployeeContractDto.Update request) {
    requireAdminOrInternal();
    EmployeeContractRepository.ContractRecord existing = contractRepository.findById(contractId)
        .orElseThrow(() -> ServiceException.notFound("Contract not found: " + contractId));
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
    requireAdminOrInternal();
    EmployeeContractRepository.ContractRecord existing = contractRepository.findById(contractId)
        .orElseThrow(() -> ServiceException.notFound("Contract not found: " + contractId));
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

  private void requireAdminOrInternal() {
    RequestUserContext context = RequestUserContextHolder.get();
    if (context.internalService() || context.hasRole("admin") || context.hasRole("superadmin")) {
      return;
    }
    context.requireUserId();
    throw ServiceException.forbidden("Administrative HR contract access is required");
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
}
