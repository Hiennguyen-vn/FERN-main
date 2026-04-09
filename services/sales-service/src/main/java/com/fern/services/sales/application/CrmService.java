package com.fern.services.sales.application;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.dorabets.common.spring.web.PagedResult;
import com.dorabets.common.spring.web.QueryConventions;
import com.fern.services.sales.api.CrmDtos;
import com.fern.services.sales.infrastructure.SalesRepository;
import java.util.Set;
import org.springframework.stereotype.Service;

@Service
public class CrmService {

  private final SalesRepository salesRepository;

  public CrmService(SalesRepository salesRepository) {
    this.salesRepository = salesRepository;
  }

  public PagedResult<CrmDtos.CustomerView> listCustomers(
      Long outletId,
      String query,
      String q,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    String normalizedQuery = QueryConventions.normalizeQuery(q);
    String effectiveQuery = normalizedQuery == null ? query : normalizedQuery;
    return salesRepository.listCustomerReferences(
        resolveReadableOutletIds(outletId),
        effectiveQuery,
        sortBy,
        sortDir,
        sanitizeLimit(limit),
        sanitizeOffset(offset)
    );
  }

  private Set<Long> resolveReadableOutletIds(Long requestedOutletId) {
    RequestUserContext context = RequestUserContextHolder.get();
    if (context.internalService() || context.hasRole("admin") || context.hasRole("superadmin")) {
      return requestedOutletId == null ? null : Set.of(requestedOutletId);
    }
    context.requireUserId();
    if (!context.hasPermission("sales.order.write")) {
      throw ServiceException.forbidden("CRM customer read access requires sales scope");
    }
    if (context.outletIds().isEmpty()) {
      throw ServiceException.forbidden("CRM customer read access requires outlet scope");
    }
    if (requestedOutletId != null) {
      if (!context.outletIds().contains(requestedOutletId)) {
        throw ServiceException.forbidden("CRM customer read access denied for outlet " + requestedOutletId);
      }
      return Set.of(requestedOutletId);
    }
    return context.outletIds();
  }

  private int sanitizeLimit(int limit) {
    return QueryConventions.sanitizeLimit(limit, 100, 500);
  }

  private int sanitizeOffset(int offset) {
    return QueryConventions.sanitizeOffset(offset);
  }
}
