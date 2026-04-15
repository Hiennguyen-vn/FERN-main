package com.fern.services.org.application;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.AuthorizationPolicyService;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.dorabets.common.spring.events.TypedKafkaEventPublisher;
import com.fern.events.org.ExchangeRateUpdatedEvent;
import com.fern.events.org.OutletCreatedEvent;
import com.fern.services.org.api.OrgDtos;
import com.fern.services.org.infrastructure.OrgRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;

@Service
public class OrgService {

  private final OrgRepository orgRepository;
  private final OrgHierarchyCacheService orgHierarchyCacheService;
  private final TypedKafkaEventPublisher kafkaEventPublisher;
  private final AuthorizationPolicyService authorizationPolicyService;
  private final Clock clock;

  public OrgService(
      OrgRepository orgRepository,
      OrgHierarchyCacheService orgHierarchyCacheService,
      TypedKafkaEventPublisher kafkaEventPublisher,
      AuthorizationPolicyService authorizationPolicyService,
      Clock clock
  ) {
    this.orgRepository = orgRepository;
    this.orgHierarchyCacheService = orgHierarchyCacheService;
    this.kafkaEventPublisher = kafkaEventPublisher;
    this.authorizationPolicyService = authorizationPolicyService;
    this.clock = clock;
  }

  public List<OrgDtos.RegionView> listRegions() {
    OrgHierarchyCacheService.CachedHierarchy hierarchy = cachedHierarchy();
    RequestUserContext context = RequestUserContextHolder.get();
    Set<Long> scopedOutletIds = resolveVisibleOutletIds(context);
    if (scopedOutletIds == null) {
      return hierarchy.regions();
    }
    Set<Long> visibleRegionIds = visibleRegionIds(hierarchy, scopedOutletIds);
    return hierarchy.regions().stream()
        .filter(region -> visibleRegionIds.contains(region.id()))
        .toList();
  }

  public OrgDtos.RegionView getRegion(String code) {
    OrgDtos.RegionView region = orgRepository.findRegionByCode(code)
        .orElseThrow(() -> ServiceException.notFound("Region not found: " + code));
    RequestUserContext context = RequestUserContextHolder.get();
    Set<Long> scopedOutletIds = resolveVisibleOutletIds(context);
    if (scopedOutletIds == null) {
      return region;
    }
    Set<Long> visibleRegionIds = visibleRegionIds(cachedHierarchy(), scopedOutletIds);
    if (!visibleRegionIds.contains(region.id())) {
      throw ServiceException.forbidden("Organization access denied for region " + code);
    }
    return region;
  }

  public List<OrgDtos.OutletView> listOutlets(Long regionId) {
    OrgHierarchyCacheService.CachedHierarchy hierarchy = cachedHierarchy();
    RequestUserContext context = RequestUserContextHolder.get();
    Set<Long> scopedOutletIds = resolveVisibleOutletIds(context);
    if (scopedOutletIds == null) {
      if (regionId == null) {
        return hierarchy.outlets();
      }
      return orgRepository.listOutlets(regionId);
    }
    return hierarchy.outlets().stream()
        .filter(outlet -> scopedOutletIds.contains(outlet.id()))
        .filter(outlet -> regionId == null || outlet.regionId() == regionId)
        .toList();
  }

  public OrgDtos.OutletView getOutlet(long outletId) {
    OrgDtos.OutletView outlet = orgRepository.findOutletById(outletId)
        .orElseThrow(() -> ServiceException.notFound("Outlet not found: " + outletId));
    RequestUserContext context = RequestUserContextHolder.get();
    Set<Long> scopedOutletIds = resolveVisibleOutletIds(context);
    if (scopedOutletIds == null) {
      return outlet;
    }
    if (!scopedOutletIds.contains(outletId)) {
      throw ServiceException.forbidden("Organization access denied for outlet " + outletId);
    }
    return outlet;
  }

  public OrgDtos.OrgHierarchyView getHierarchy() {
    OrgHierarchyCacheService.CachedHierarchy cachedHierarchy = cachedHierarchy();
    RequestUserContext context = RequestUserContextHolder.get();
    Set<Long> scopedOutletIds = resolveVisibleOutletIds(context);
    if (scopedOutletIds == null) {
      return new OrgDtos.OrgHierarchyView(cachedHierarchy.regions(), cachedHierarchy.outlets());
    }
    List<OrgDtos.OutletView> outlets = cachedHierarchy.outlets().stream()
        .filter(outlet -> scopedOutletIds.contains(outlet.id()))
        .toList();
    Set<Long> visibleRegionIds = visibleRegionIds(cachedHierarchy, scopedOutletIds);
    List<OrgDtos.RegionView> regions = cachedHierarchy.regions().stream()
        .filter(region -> visibleRegionIds.contains(region.id()))
        .toList();
    return new OrgDtos.OrgHierarchyView(regions, outlets);
  }

  public OrgDtos.ExchangeRateView findExchangeRate(String fromCurrencyCode, String toCurrencyCode, LocalDate onDate) {
    requireAuthenticatedRead(RequestUserContextHolder.get());
    return orgRepository.findExchangeRate(fromCurrencyCode, toCurrencyCode, onDate == null ? LocalDate.now() : onDate)
        .orElseThrow(() -> ServiceException.notFound(
            "Exchange rate not found for " + fromCurrencyCode + " -> " + toCurrencyCode
        ));
  }

  public OrgDtos.OutletView createOutlet(OrgDtos.CreateOutletRequest request) {
    RequestUserContext context = RequestUserContextHolder.get();
    requireMutationAccess(context);
    OrgDtos.OutletView outlet = orgRepository.createOutlet(request);
    orgHierarchyCacheService.evict();
    kafkaEventPublisher.publish(
        "fern.org.outlet-created",
        Long.toString(outlet.id()),
        "org.outlet.created",
        new OutletCreatedEvent(
            outlet.id(),
            outlet.regionId(),
            outlet.code(),
            outlet.name(),
            outlet.status(),
            outlet.openedAt(),
            clock.instant(),
            context.userId()
        )
    );
    return outlet;
  }

  public OrgDtos.ExchangeRateView upsertExchangeRate(OrgDtos.UpdateExchangeRateRequest request) {
    RequestUserContext context = RequestUserContextHolder.get();
    requireMutationAccess(context);
    if (request.fromCurrencyCode().compareToIgnoreCase(request.toCurrencyCode()) >= 0) {
      throw ServiceException.badRequest("fromCurrencyCode must be alphabetically before toCurrencyCode");
    }
    OrgDtos.ExchangeRateView exchangeRate = orgRepository.upsertExchangeRate(request);
    kafkaEventPublisher.publish(
        "fern.org.exchange-rate-updated",
        exchangeRate.fromCurrencyCode() + "-" + exchangeRate.toCurrencyCode(),
        "org.exchange_rate.updated",
        new ExchangeRateUpdatedEvent(
            exchangeRate.fromCurrencyCode(),
            exchangeRate.toCurrencyCode(),
            exchangeRate.rate(),
            exchangeRate.effectiveFrom(),
            exchangeRate.effectiveTo(),
            clock.instant(),
            context.userId()
        )
    );
    return exchangeRate;
  }

  private OrgHierarchyCacheService.CachedHierarchy loadHierarchy() {
    return new OrgHierarchyCacheService.CachedHierarchy(
        orgRepository.listRegions(),
        orgRepository.listOutlets(null)
    );
  }

  private OrgHierarchyCacheService.CachedHierarchy cachedHierarchy() {
    return orgHierarchyCacheService.getOrLoad(orgRepository.hierarchyVersionKey(), this::loadHierarchy);
  }

  /**
   * Returns the set of outlet IDs the current user can see, or null for
   * unrestricted access (superadmin / internal service).
   */
  private Set<Long> resolveVisibleOutletIds(RequestUserContext context) {
    return authorizationPolicyService.resolveOrgReadableOutletIds(context);
  }

  private void requireAuthenticatedRead(RequestUserContext context) {
    if (!authorizationPolicyService.hasAdministrativeOrgAccess(context)) {
      context.requireUserId();
    }
  }

  private Set<Long> visibleRegionIds(
      OrgHierarchyCacheService.CachedHierarchy hierarchy,
      Set<Long> outletIds
  ) {
    Map<Long, OrgDtos.RegionView> regionsById = new LinkedHashMap<>();
    hierarchy.regions().forEach(region -> regionsById.put(region.id(), region));
    Set<Long> visibleRegionIds = new LinkedHashSet<>();
    hierarchy.outlets().stream()
        .filter(outlet -> outletIds.contains(outlet.id()))
        .forEach(outlet -> addRegionPath(visibleRegionIds, regionsById, outlet.regionId()));
    return Set.copyOf(visibleRegionIds);
  }

  private void addRegionPath(
      Set<Long> target,
      Map<Long, OrgDtos.RegionView> regionsById,
      long regionId
  ) {
    Long currentId = regionId;
    while (currentId != null && target.add(currentId)) {
      OrgDtos.RegionView region = regionsById.get(currentId);
      if (region == null) {
        return;
      }
      currentId = region.parentRegionId();
    }
  }

  private void requireMutationAccess(RequestUserContext context) {
    if (authorizationPolicyService.canMutateOrg(context)) {
      return;
    }
    throw ServiceException.forbidden("Administrative org access is required");
  }
}
