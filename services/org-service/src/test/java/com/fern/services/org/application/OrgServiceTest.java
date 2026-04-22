package com.fern.services.org.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

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
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class OrgServiceTest {

  @Mock
  private OrgRepository orgRepository;
  @Mock
  private OrgHierarchyCacheService orgHierarchyCacheService;
  @Mock
  private TypedKafkaEventPublisher kafkaEventPublisher;
  @Mock
  private AuthorizationPolicyService authorizationPolicyService;

  private final Clock clock = Clock.fixed(Instant.parse("2026-03-27T00:00:00Z"), ZoneOffset.UTC);

  @AfterEach
  void clearContext() {
    RequestUserContextHolder.clear();
  }

  @Test
  void listRegionsUsesCachedHierarchy() {
    RequestUserContextHolder.set(adminContext());
    when(authorizationPolicyService.resolveOrgReadableOutletIds(any())).thenReturn(null);
    OrgDtos.RegionView region = new OrgDtos.RegionView(1L, "VN", null, "VND", "Vietnam", null, "Asia/Ho_Chi_Minh");
    when(orgHierarchyCacheService.getOrLoad(any(), any())).thenReturn(
        new OrgHierarchyCacheService.CachedHierarchy(List.of(region), List.of())
    );

    OrgService service = service();
    List<OrgDtos.RegionView> result = service.listRegions();

    assertEquals(1, result.size());
    assertEquals("VN", result.getFirst().code());
  }

  @Test
  void listOutletsFiltersToScopedOutletsForNonAdmin() {
    RequestUserContextHolder.set(outletManagerContext());
    when(authorizationPolicyService.resolveOrgReadableOutletIds(any())).thenReturn(Set.of(2000L));
    when(orgHierarchyCacheService.getOrLoad(any(), any())).thenReturn(sampleHierarchy());

    OrgService service = service();
    List<OrgDtos.OutletView> result = service.listOutlets(null);

    assertEquals(1, result.size());
    assertEquals(2000L, result.getFirst().id());
  }

  @Test
  void getOutletRejectsOutOfScopeOutletForNonAdmin() {
    RequestUserContextHolder.set(outletManagerContext());
    when(authorizationPolicyService.resolveOrgReadableOutletIds(any())).thenReturn(Set.of(2000L));
    OrgDtos.OutletView outlet = outletView(2001L, 101L, "US-NYC-001", "New York Flagship Outlet", "active");
    when(orgRepository.findOutletById(2001L)).thenReturn(Optional.of(outlet));

    OrgService service = service();

    assertThrows(ServiceException.class, () -> service.getOutlet(2001L));
  }

  @Test
  void getHierarchyOnlyReturnsVisibleRegionTreeForScopedUser() {
    RequestUserContextHolder.set(outletManagerContext());
    when(authorizationPolicyService.resolveOrgReadableOutletIds(any())).thenReturn(Set.of(2000L));
    when(orgHierarchyCacheService.getOrLoad(any(), any())).thenReturn(sampleHierarchy());

    OrgService service = service();
    OrgDtos.OrgHierarchyView result = service.getHierarchy();

    assertEquals(Set.of(1L, 10L), result.regions().stream().map(OrgDtos.RegionView::id).collect(java.util.stream.Collectors.toSet()));
    assertEquals(List.of(2000L), result.outlets().stream().map(OrgDtos.OutletView::id).toList());
  }

  @Test
  void getRegionAllowsAncestorOfScopedOutletButRejectsUnrelatedRegion() {
    RequestUserContextHolder.set(outletManagerContext());
    when(authorizationPolicyService.resolveOrgReadableOutletIds(any())).thenReturn(Set.of(2000L));
    when(orgHierarchyCacheService.getOrLoad(any(), any())).thenReturn(sampleHierarchy());
    when(orgRepository.findRegionByCode("VN")).thenReturn(Optional.of(sampleHierarchy().regions().getFirst()));
    when(orgRepository.findRegionByCode("US")).thenReturn(Optional.of(sampleHierarchy().regions().get(2)));

    OrgService service = service();

    assertEquals("VN", service.getRegion("VN").code());
    assertThrows(ServiceException.class, () -> service.getRegion("US"));
  }

  @Test
  void createRegionEvictsCacheAndPublishesEvent() {
    RequestUserContextHolder.set(adminContext());
    when(authorizationPolicyService.canMutateOrg(any())).thenReturn(true);
    when(orgRepository.listRegions()).thenReturn(sampleHierarchy().regions());
    OrgDtos.CreateRegionRequest request = new OrgDtos.CreateRegionRequest(
        "VN-HN",
        1L,
        "VND",
        "Hanoi",
        "VAT",
        "Asia/Ho_Chi_Minh"
    );
    OrgDtos.RegionView region = new OrgDtos.RegionView(55L, "VN-HN", 1L, "VND", "Hanoi", "VAT", "Asia/Ho_Chi_Minh");
    when(orgRepository.createRegion(request)).thenReturn(region);

    OrgService service = service();
    OrgDtos.RegionView result = service.createRegion(request);

    verify(orgHierarchyCacheService).evict();
    verify(kafkaEventPublisher).publish(
        eq("fern.org.region-created"),
        eq("55"),
        eq("org.region.created"),
        any(RegionCreatedEvent.class)
    );
    assertEquals(55L, result.id());
  }

  @Test
  void updateRegionRejectsCycles() {
    RequestUserContextHolder.set(adminContext());
    when(authorizationPolicyService.canMutateOrg(any())).thenReturn(true);
    OrgDtos.RegionView existing = sampleHierarchy().regions().getFirst();
    when(orgRepository.findRegionByCode("VN")).thenReturn(Optional.of(existing));
    when(orgRepository.listRegions()).thenReturn(sampleHierarchy().regions());

    OrgService service = service();

    assertThrows(ServiceException.class, () -> service.updateRegion(
        "VN",
        new OrgDtos.UpdateRegionRequest(10L, "VND", "Vietnam", "VAT", "Asia/Ho_Chi_Minh")
    ));
  }

  @Test
  void updateRegionPublishesUpdateEvent() {
    RequestUserContextHolder.set(adminContext());
    when(authorizationPolicyService.canMutateOrg(any())).thenReturn(true);
    OrgDtos.RegionView existing = sampleHierarchy().regions().get(1);
    when(orgRepository.findRegionByCode("VN-HCM")).thenReturn(Optional.of(existing));
    when(orgRepository.listRegions()).thenReturn(sampleHierarchy().regions());
    OrgDtos.UpdateRegionRequest request = new OrgDtos.UpdateRegionRequest(
        1L,
        "VND",
        "Ho Chi Minh City",
        "VAT",
        "Asia/Ho_Chi_Minh"
    );
    OrgDtos.RegionView updated = new OrgDtos.RegionView(10L, "VN-HCM", 1L, "VND", "Ho Chi Minh City", "VAT", "Asia/Ho_Chi_Minh");
    when(orgRepository.updateRegion(10L, request)).thenReturn(updated);

    OrgService service = service();
    OrgDtos.RegionView result = service.updateRegion("VN-HCM", request);

    verify(orgHierarchyCacheService).evict();
    verify(kafkaEventPublisher).publish(
        eq("fern.org.region-updated"),
        eq("10"),
        eq("org.region.updated"),
        any(RegionUpdatedEvent.class)
    );
    assertEquals("Ho Chi Minh City", result.name());
  }

  @Test
  void createOutletEvictsCacheAndPublishesEvent() {
    RequestUserContextHolder.set(adminContext());
    when(authorizationPolicyService.canMutateOrg(any())).thenReturn(true);
    OrgDtos.CreateOutletRequest request = new OrgDtos.CreateOutletRequest(
        1L,
        "VN-HCM-001",
        "District 1 Outlet",
        "active",
        "1 Street",
        "123",
        "outlet@example.com",
        LocalDate.parse("2026-03-27"),
        null
    );
    OrgDtos.OutletView outlet = outletView(101L, 1L, "VN-HCM-001", "District 1 Outlet", "active");
    when(orgRepository.createOutlet(request)).thenReturn(outlet);

    OrgService service = service();
    OrgDtos.OutletView result = service.createOutlet(request);

    verify(orgHierarchyCacheService).evict();
    verify(kafkaEventPublisher).publish(
        eq("fern.org.outlet-created"),
        eq("1"),   // regionId, not outletId — key changed for same-region ordering guarantee
        eq("org.outlet.created"),
        any(OutletCreatedEvent.class)
    );
    assertEquals(101L, result.id());
  }

  @Test
  void updateOutletRejectsArchivedRecords() {
    RequestUserContextHolder.set(adminContext());
    when(authorizationPolicyService.canMutateOrg(any())).thenReturn(true);
    when(orgRepository.findManagedOutletById(2000L)).thenReturn(Optional.of(outletView(2000L, 10L, "VN-HCM-001", "Saigon Central Outlet", "archived")));

    OrgService service = service();

    assertThrows(ServiceException.class, () -> service.updateOutlet(
        2000L,
        new OrgDtos.UpdateOutletRequest(
            "VN-HCM-001",
            "Saigon Central Outlet",
            "1 Nguyen Hue",
            "123",
            "hcm@example.com",
            LocalDate.parse("2026-01-01"),
            null
        )
    ));
  }

  @Test
  void updateOutletStatusRejectsInvalidTransitions() {
    RequestUserContextHolder.set(adminContext());
    when(authorizationPolicyService.canMutateOrg(any())).thenReturn(true);
    when(orgRepository.findManagedOutletById(2000L)).thenReturn(Optional.of(outletView(2000L, 10L, "VN-HCM-001", "Saigon Central Outlet", "active")));

    OrgService service = service();

    assertThrows(ServiceException.class, () -> service.updateOutletStatus(
        2000L,
        new OrgDtos.UpdateOutletStatusRequest("archived", "Manual archive")
    ));
  }

  @Test
  void updateOutletStatusPublishesUpdateEvent() {
    RequestUserContextHolder.set(adminContext());
    when(authorizationPolicyService.canMutateOrg(any())).thenReturn(true);
    when(orgRepository.findManagedOutletById(2000L)).thenReturn(Optional.of(outletView(2000L, 10L, "VN-HCM-001", "Saigon Central Outlet", "closed")));
    OrgDtos.OutletView archivedOutlet = outletView(2000L, 10L, "VN-HCM-001", "Saigon Central Outlet", "archived");
    when(orgRepository.updateOutletStatus(2000L, "archived")).thenReturn(archivedOutlet);

    OrgService service = service();
    OrgDtos.OutletView result = service.updateOutletStatus(
        2000L,
        new OrgDtos.UpdateOutletStatusRequest("archived", "Store closed permanently")
    );

    verify(orgHierarchyCacheService).evict();
    verify(kafkaEventPublisher).publish(
        eq("fern.org.outlet-updated"),
        eq("10"),   // regionId, not outletId — key changed for same-region ordering guarantee
        eq("org.outlet.updated"),
        any(OutletUpdatedEvent.class)
    );
    assertEquals("archived", result.status());
  }

  @Test
  void updateOutletPublishesUpdateEventWithRegionIdKey() {
    RequestUserContextHolder.set(adminContext());
    when(authorizationPolicyService.canMutateOrg(any())).thenReturn(true);
    when(orgRepository.findManagedOutletById(2000L)).thenReturn(Optional.of(outletView(2000L, 10L, "VN-HCM-001", "Saigon Central", "active")));
    OrgDtos.OutletView updatedOutlet = outletView(2000L, 10L, "VN-HCM-001", "Saigon Central Updated", "active");
    when(orgRepository.updateOutlet(eq(2000L), any())).thenReturn(updatedOutlet);

    OrgService service = service();
    service.updateOutlet(
        2000L,
        new OrgDtos.UpdateOutletRequest(
            "VN-HCM-001",
            "Saigon Central Updated",
            "1 Nguyen Hue",
            "123",
            "hcm@example.com",
            LocalDate.parse("2026-01-01"),
            null
        )
    );

    verify(kafkaEventPublisher).publish(
        eq("fern.org.outlet-updated"),
        eq("10"),   // regionId key, not outletId
        eq("org.outlet.updated"),
        any(OutletUpdatedEvent.class)
    );
  }

  @Test
  void upsertExchangeRateRejectsOutOfOrderCurrencyCodes() {
    RequestUserContextHolder.set(adminContext());
    when(authorizationPolicyService.canMutateOrg(any())).thenReturn(true);
    OrgService service = service();

    assertThrows(ServiceException.class, () -> service.upsertExchangeRate(new OrgDtos.UpdateExchangeRateRequest(
        "USD",
        "EUR",
        new BigDecimal("1.10"),
        LocalDate.parse("2026-03-27"),
        null
    )));
  }

  @Test
  void upsertExchangeRatePublishesUpdateEvent() {
    RequestUserContextHolder.set(adminContext());
    when(authorizationPolicyService.canMutateOrg(any())).thenReturn(true);
    OrgDtos.UpdateExchangeRateRequest request = new OrgDtos.UpdateExchangeRateRequest(
        "EUR",
        "USD",
        new BigDecimal("1.10"),
        LocalDate.parse("2026-03-27"),
        null
    );
    OrgDtos.ExchangeRateView exchangeRate = new OrgDtos.ExchangeRateView(
        "EUR",
        "USD",
        new BigDecimal("1.10"),
        LocalDate.parse("2026-03-27"),
        null,
        Instant.parse("2026-03-27T00:00:00Z")
    );
    when(orgRepository.upsertExchangeRate(request)).thenReturn(exchangeRate);

    OrgService service = service();
    OrgDtos.ExchangeRateView result = service.upsertExchangeRate(request);

    verify(kafkaEventPublisher).publish(
        eq("fern.org.exchange-rate-updated"),
        eq("EUR-USD"),
        eq("org.exchange_rate.updated"),
        any(ExchangeRateUpdatedEvent.class)
    );
    assertEquals(new BigDecimal("1.10"), result.rate());
  }

  private OrgService service() {
    return new OrgService(orgRepository, orgHierarchyCacheService, kafkaEventPublisher, authorizationPolicyService, clock);
  }

  private RequestUserContext adminContext() {
    return new RequestUserContext(7L, "admin", "sess-admin", Set.of("admin"), Set.of(), Set.of(), true, false, null);
  }

  private RequestUserContext outletManagerContext() {
    return new RequestUserContext(12L, "manager", "sess-12", Set.of("outlet_manager"), Set.of(), Set.of(2000L), true, false, null);
  }

  private OrgDtos.OutletView outletView(long id, long regionId, String code, String name, String status) {
    return new OrgDtos.OutletView(
        id,
        regionId,
        code,
        name,
        status,
        "1 Nguyen Hue",
        "123",
        "outlet@example.com",
        LocalDate.parse("2026-01-01"),
        null
    );
  }

  private OrgHierarchyCacheService.CachedHierarchy sampleHierarchy() {
    List<OrgDtos.RegionView> regions = List.of(
        new OrgDtos.RegionView(1L, "VN", null, "VND", "Vietnam", "VAT", "Asia/Ho_Chi_Minh"),
        new OrgDtos.RegionView(10L, "VN-HCM", 1L, "VND", "Ho Chi Minh", "VAT", "Asia/Ho_Chi_Minh"),
        new OrgDtos.RegionView(100L, "US", null, "USD", "United States", "SALES", "America/New_York"),
        new OrgDtos.RegionView(101L, "US-NYC", 100L, "USD", "New York", "SALES", "America/New_York")
    );
    List<OrgDtos.OutletView> outlets = List.of(
        outletView(2000L, 10L, "VN-HCM-001", "Saigon Central Outlet", "active"),
        new OrgDtos.OutletView(
            2001L,
            101L,
            "US-NYC-001",
            "New York Flagship Outlet",
            "active",
            "5th Avenue",
            "123",
            "ny@example.com",
            LocalDate.parse("2026-01-01"),
            null
        )
    );
    return new OrgHierarchyCacheService.CachedHierarchy(regions, outlets);
  }
}
