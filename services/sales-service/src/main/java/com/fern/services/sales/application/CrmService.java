package com.fern.services.sales.application;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.AuthorizationPolicyService;
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
  private final AuthorizationPolicyService authorizationPolicyService;

  public CrmService(SalesRepository salesRepository, AuthorizationPolicyService authorizationPolicyService) {
    this.salesRepository = salesRepository;
    this.authorizationPolicyService = authorizationPolicyService;
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
    Set<Long> readable = authorizationPolicyService.resolveSalesReadableOutletIds(context);
    if (readable == null) {
      return requestedOutletId == null ? null : Set.of(requestedOutletId);
    }
    if (readable.isEmpty()) {
      throw ServiceException.forbidden("CRM customer read access requires outlet scope");
    }
    if (requestedOutletId != null) {
      if (!readable.contains(requestedOutletId)) {
        throw ServiceException.forbidden("CRM customer read access denied for outlet " + requestedOutletId);
      }
      return Set.of(requestedOutletId);
    }
    return readable;
  }

  private int sanitizeLimit(int limit) {
    return QueryConventions.sanitizeLimit(limit, 100, 500);
  }

  private int sanitizeOffset(int offset) {
    return QueryConventions.sanitizeOffset(offset);
  }
}
