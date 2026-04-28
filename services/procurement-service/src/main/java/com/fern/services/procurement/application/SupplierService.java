package com.fern.services.procurement.application;

import com.fern.common.middleware.ServiceException;
import com.fern.common.spring.auth.AuthorizationPolicyService;
import com.fern.common.spring.auth.RequestUserContext;
import com.fern.common.spring.auth.RequestUserContextHolder;
import com.fern.common.spring.web.PagedResult;
import com.fern.common.spring.web.QueryConventions;
import com.fern.services.procurement.api.ProcurementDtos;
import com.fern.services.procurement.infrastructure.ProcurementRepository;
import com.fern.common.utils.services.id.SnowflakeIdGenerator;
import java.util.Set;
import org.springframework.stereotype.Service;

@Service
public class SupplierService {

  private final ProcurementRepository procurementRepository;
  private final SnowflakeIdGenerator idGenerator;
  private final AuthorizationPolicyService authorizationPolicyService;

  public SupplierService(
      ProcurementRepository procurementRepository,
      SnowflakeIdGenerator idGenerator,
      AuthorizationPolicyService authorizationPolicyService
  ) {
    this.procurementRepository = procurementRepository;
    this.idGenerator = idGenerator;
    this.authorizationPolicyService = authorizationPolicyService;
  }

  public ProcurementDtos.SupplierView createSupplier(ProcurementDtos.CreateSupplierRequest request) {
    requireGlobalProcurementWrite();
    return procurementRepository.createSupplier(idGenerator.generateId(), request);
  }

  public ProcurementDtos.SupplierView getSupplier(long supplierId) {
    requireGlobalProcurementRead();
    return procurementRepository.findSupplier(supplierId)
        .orElseThrow(() -> ServiceException.notFound("Supplier not found: " + supplierId));
  }

  public PagedResult<ProcurementDtos.SupplierView> listSuppliers(
      Long regionId,
      String status,
      String q,
      String sortBy,
      String sortDir,
      Integer limit,
      Integer offset
  ) {
    requireGlobalProcurementRead();
    return procurementRepository.listSuppliers(
        regionId,
        status,
        QueryConventions.normalizeQuery(q),
        sortBy,
        sortDir,
        QueryConventions.sanitizeLimit(limit, 50, 200),
        QueryConventions.sanitizeOffset(offset)
    );
  }

  public ProcurementDtos.SupplierView updateSupplier(long supplierId, ProcurementDtos.UpdateSupplierRequest request) {
    requireGlobalProcurementWrite();
    return procurementRepository.updateSupplier(supplierId, request);
  }

  private void requireGlobalProcurementWrite() {
    RequestUserContext context = RequestUserContextHolder.get();
    if (context.internalService()) {
      return;
    }
    context.requireUserId();
    boolean allowed = context.outletIds().stream()
        .anyMatch(outletId -> authorizationPolicyService.canWriteProcurement(context, outletId));
    if (!allowed) {
      throw ServiceException.forbidden("Procurement write access is required");
    }
  }

  private void requireGlobalProcurementRead() {
    RequestUserContext context = RequestUserContextHolder.get();
    Set<Long> readable = authorizationPolicyService.resolveProcurementReadableOutletIds(context);
    if (readable == null) {
      return;
    }
    if (readable.isEmpty()) {
      throw ServiceException.forbidden("Procurement read access requires outlet scope");
    }
  }
}
