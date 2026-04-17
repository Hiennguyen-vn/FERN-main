package com.fern.services.org.application;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.AuthorizationPolicyService;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.dorabets.common.spring.events.TypedKafkaEventPublisher;
import com.fern.events.org.ExchangeRateUpdatedEvent;
import com.fern.events.org.OutletCreatedEvent;
import com.fern.events.org.OutletUpdatedEvent;
import com.fern.events.org.RegionCreatedEvent;
import com.fern.events.org.RegionUpdatedEvent;
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

  public OrgDtos.RegionView createRegion(OrgDtos.CreateRegionRequest request) {
    RequestUserContext context = RequestUserContextHolder.get();
    requireMutationAccess(context);
    validateRegionHierarchy(null, request.parentRegionId());
    OrgDtos.RegionView region = orgRepository.createRegion(request);
    orgHierarchyCacheService.evict();
    kafkaEventPublisher.publish(
        "fern.org.region-created",
        Long.toString(region.id()),
        "org.region.created",
        new RegionCreatedEvent(
            region.id(),
            region.code(),
            region.parentRegionId(),
            region.currencyCode(),
            region.name(),
            region.taxCode(),
            region.timezoneName(),
            clock.instant(),
            context.userId()
        )
    );
    return region;
  }

  public OrgDtos.RegionView updateRegion(String code, OrgDtos.UpdateRegionRequest request) {
    RequestUserContext context = RequestUserContextHolder.get();
    requireMutationAccess(context);
    OrgDtos.RegionView existing = orgRepository.findRegionByCode(code)
        .orElseThrow(() -> ServiceException.notFound("Region not found: " + code));
    validateRegionHierarchy(existing.id(), request.parentRegionId());
    OrgDtos.RegionView region = orgRepository.updateRegion(existing.id(), request);
    orgHierarchyCacheService.evict();
    kafkaEventPublisher.publish(
        "fern.org.region-updated",
        Long.toString(region.id()),
        "org.region.updated",
        new RegionUpdatedEvent(
            region.id(),
            region.code(),
            region.parentRegionId(),
            region.currencyCode(),
            region.name(),
            region.taxCode(),
            region.timezoneName(),
            clock.instant(),
            context.userId()
        )
    );
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
    validateOutletDates(request.openedAt(), request.closedAt());
    String status = normalizeCreateStatus(request.status());
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
            status,
            outlet.openedAt(),
            clock.instant(),
            context.userId()
        )
    );
    return outlet;
  }

  public OrgDtos.OutletView updateOutlet(long outletId, OrgDtos.UpdateOutletRequest request) {
    RequestUserContext context = RequestUserContextHolder.get();
    requireMutationAccess(context);
    validateOutletDates(request.openedAt(), request.closedAt());
    OrgDtos.OutletView existing = orgRepository.findManagedOutletById(outletId)
        .orElseThrow(() -> ServiceException.notFound("Outlet not found: " + outletId));
    if ("archived".equalsIgnoreCase(existing.status())) {
      throw ServiceException.conflict("Archived outlet cannot be updated");
    }
    OrgDtos.OutletView outlet = orgRepository.updateOutlet(outletId, request);
    orgHierarchyCacheService.evict();
    publishOutletUpdated(outlet, null, context.userId());
    return outlet;
  }

  public OrgDtos.OutletView updateOutletStatus(long outletId, OrgDtos.UpdateOutletStatusRequest request) {
    RequestUserContext context = RequestUserContextHolder.get();
    requireMutationAccess(context);
    String targetStatus = normalizeLifecycleStatus(request.targetStatus());
    OrgDtos.OutletView existing = orgRepository.findManagedOutletById(outletId)
        .orElseThrow(() -> ServiceException.notFound("Outlet not found: " + outletId));
    validateStatusTransition(existing.status(), targetStatus, request.reason());
    OrgDtos.OutletView outlet = orgRepository.updateOutletStatus(outletId, targetStatus);
    orgHierarchyCacheService.evict();
    publishOutletUpdated(outlet, trimToNull(request.reason()), context.userId());
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

  private void validateRegionHierarchy(Long regionId, Long parentRegionId) {
    if (parentRegionId == null) {
      return;
    }
    Map<Long, OrgDtos.RegionView> regionsById = new LinkedHashMap<>();
    orgRepository.listRegions().forEach(region -> regionsById.put(region.id(), region));
    if (!regionsById.containsKey(parentRegionId)) {
      throw ServiceException.notFound("Parent region not found: " + parentRegionId);
    }
    if (regionId == null) {
      return;
    }
    if (regionId.equals(parentRegionId)) {
      throw ServiceException.badRequest("parentRegionId cannot equal the current region");
    }
    Long currentId = parentRegionId;
    while (currentId != null) {
      if (regionId.equals(currentId)) {
        throw ServiceException.badRequest("parentRegionId would create a cycle");
      }
      OrgDtos.RegionView current = regionsById.get(currentId);
      currentId = current == null ? null : current.parentRegionId();
    }
  }

  private void validateOutletDates(LocalDate openedAt, LocalDate closedAt) {
    if (openedAt != null && closedAt != null && closedAt.isBefore(openedAt)) {
      throw ServiceException.badRequest("closedAt must be on or after openedAt");
    }
  }

  private String normalizeCreateStatus(String status) {
    String normalized = normalizeLifecycleStatus(status == null || status.isBlank() ? "draft" : status);
    if ("archived".equals(normalized)) {
      throw ServiceException.badRequest("Outlet cannot be created in archived status");
    }
    return normalized;
  }

  private String normalizeLifecycleStatus(String status) {
    if (status == null || status.isBlank()) {
      throw ServiceException.badRequest("targetStatus is required");
    }
    String normalized = status.trim().toLowerCase();
    if (!Set.of("draft", "active", "inactive", "closed", "archived").contains(normalized)) {
      throw ServiceException.badRequest("Unsupported outlet status: " + status);
    }
    return normalized;
  }

  private void validateStatusTransition(String currentStatus, String targetStatus, String reason) {
    String normalizedCurrent = normalizeLifecycleStatus(currentStatus);
    if (normalizedCurrent.equals(targetStatus)) {
      return;
    }
    if (Set.of("inactive", "closed", "archived").contains(targetStatus) && trimToNull(reason) == null) {
      throw ServiceException.badRequest("reason is required for this status change");
    }
    boolean allowed = switch (normalizedCurrent) {
      case "draft" -> Set.of("active", "inactive", "closed").contains(targetStatus);
      case "active" -> Set.of("inactive", "closed").contains(targetStatus);
      case "inactive" -> Set.of("active", "closed").contains(targetStatus);
      case "closed" -> "archived".equals(targetStatus);
      case "archived" -> false;
      default -> false;
    };
    if (!allowed) {
      throw ServiceException.conflict("Unsupported outlet status transition: " + normalizedCurrent + " -> " + targetStatus);
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

  private void publishOutletUpdated(OrgDtos.OutletView outlet, String reason, Long actorUserId) {
    kafkaEventPublisher.publish(
        "fern.org.outlet-updated",
        Long.toString(outlet.id()),
        "org.outlet.updated",
        new OutletUpdatedEvent(
            outlet.id(),
            outlet.regionId(),
            outlet.code(),
            outlet.status(),
            outlet.name(),
            outlet.address(),
            outlet.phone(),
            outlet.email(),
            outlet.openedAt(),
            outlet.closedAt(),
            reason,
            clock.instant(),
            actorUserId
        )
    );
  }

  private String trimToNull(String value) {
    if (value == null) {
      return null;
    }
    String trimmed = value.trim();
    return trimmed.isEmpty() ? null : trimmed;
  }
}
