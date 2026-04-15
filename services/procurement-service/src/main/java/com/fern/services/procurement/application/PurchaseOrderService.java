package com.fern.services.procurement.application;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.AuthorizationPolicyService;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.dorabets.common.spring.web.PagedResult;
import com.dorabets.common.spring.web.QueryConventions;
import com.fern.services.procurement.api.ProcurementDtos;
import com.fern.services.procurement.infrastructure.ProcurementRepository;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import java.time.LocalDate;
import java.util.Set;
import org.springframework.stereotype.Service;

@Service
public class PurchaseOrderService {

  private final ProcurementRepository procurementRepository;
  private final SnowflakeIdGenerator idGenerator;
  private final AuthorizationPolicyService authorizationPolicyService;

  public PurchaseOrderService(
      ProcurementRepository procurementRepository,
      SnowflakeIdGenerator idGenerator,
      AuthorizationPolicyService authorizationPolicyService
  ) {
    this.procurementRepository = procurementRepository;
    this.idGenerator = idGenerator;
    this.authorizationPolicyService = authorizationPolicyService;
  }

  public ProcurementDtos.PurchaseOrderView createPurchaseOrder(ProcurementDtos.CreatePurchaseOrderRequest request) {
    requireProcurementWrite(request.outletId(), false);
    return procurementRepository.createPurchaseOrder(
        idGenerator.generateId(),
        request,
        RequestUserContextHolder.get().userId()
    );
  }

  public ProcurementDtos.PurchaseOrderView getPurchaseOrder(long purchaseOrderId) {
    ProcurementDtos.PurchaseOrderView view = procurementRepository.findPurchaseOrder(purchaseOrderId)
        .orElseThrow(() -> ServiceException.notFound("Purchase order not found: " + purchaseOrderId));
    requireProcurementRead(view.outletId());
    return view;
  }

  public PagedResult<ProcurementDtos.PurchaseOrderListItemView> listPurchaseOrders(
      Long outletId,
      Long supplierId,
      String status,
      LocalDate startDate,
      LocalDate endDate,
      String q,
      String sortBy,
      String sortDir,
      Integer limit,
      Integer offset
  ) {
    return procurementRepository.listPurchaseOrders(
        resolveReadableOutletIds(outletId),
        supplierId,
        status,
        startDate,
        endDate,
        QueryConventions.normalizeQuery(q),
        sortBy,
        sortDir,
        sanitizeLimit(limit),
        sanitizeOffset(offset)
    );
  }

  public ProcurementDtos.PurchaseOrderView approvePurchaseOrder(long purchaseOrderId) {
    ProcurementDtos.PurchaseOrderView view = procurementRepository.findPurchaseOrder(purchaseOrderId)
        .orElseThrow(() -> ServiceException.notFound("Purchase order not found: " + purchaseOrderId));
    requireProcurementWrite(view.outletId(), true);
    return procurementRepository.approvePurchaseOrder(purchaseOrderId, RequestUserContextHolder.get().userId());
  }

  private void requireProcurementWrite(long outletId, boolean approval) {
    RequestUserContext context = RequestUserContextHolder.get();
    if (approval) {
      if (authorizationPolicyService.canApproveProcurement(context, outletId)) {
        return;
      }
    } else {
      if (authorizationPolicyService.canWriteProcurement(context, outletId)) {
        return;
      }
    }
    throw ServiceException.forbidden("Procurement write access is required for outlet " + outletId);
  }

  private void requireProcurementRead(long outletId) {
    RequestUserContext context = RequestUserContextHolder.get();
    if (authorizationPolicyService.canReadProcurement(context, outletId)) {
      return;
    }
    throw ServiceException.forbidden("Procurement read access denied for outlet " + outletId);
  }

  private Set<Long> resolveReadableOutletIds(Long requestedOutletId) {
    RequestUserContext context = RequestUserContextHolder.get();
    Set<Long> readable = authorizationPolicyService.resolveProcurementReadableOutletIds(context);
    if (readable == null) {
      return requestedOutletId == null ? null : Set.of(requestedOutletId);
    }
    if (requestedOutletId != null) {
      if (!readable.contains(requestedOutletId)) {
        throw ServiceException.forbidden("Procurement read access denied for outlet " + requestedOutletId);
      }
      return Set.of(requestedOutletId);
    }
    return readable;
  }

  private int sanitizeLimit(Integer limit) {
    return QueryConventions.sanitizeLimit(limit, 50, 100);
  }

  private int sanitizeOffset(Integer offset) {
    return QueryConventions.sanitizeOffset(offset);
  }
}
