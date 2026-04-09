package com.fern.services.org.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.dorabets.common.spring.events.TypedKafkaEventPublisher;
import com.fern.events.org.ExchangeRateUpdatedEvent;
import com.fern.events.org.OutletCreatedEvent;
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

  private final Clock clock = Clock.fixed(Instant.parse("2026-03-27T00:00:00Z"), ZoneOffset.UTC);

  @AfterEach
  void clearContext() {
    RequestUserContextHolder.clear();
  }

  @Test
  void listRegionsUsesCachedHierarchy() {
    RequestUserContextHolder.set(new RequestUserContext(
        7L, "admin", "sess-admin", Set.of("admin"), Set.of(), Set.of(), true, false, null
    ));
    OrgDtos.RegionView region = new OrgDtos.RegionView(1L, "VN", null, "VND", "Vietnam", null, "Asia/Ho_Chi_Minh");
    when(orgHierarchyCacheService.getOrLoad(any(), any())).thenReturn(
        new OrgHierarchyCacheService.CachedHierarchy(List.of(region), List.of())
    );

    OrgService service = new OrgService(orgRepository, orgHierarchyCacheService, kafkaEventPublisher, clock);
    List<OrgDtos.RegionView> result = service.listRegions();

    assertEquals(1, result.size());
    assertEquals("VN", result.getFirst().code());
  }

  @Test
  void listOutletsFiltersToScopedOutletsForNonAdmin() {
    RequestUserContextHolder.set(new RequestUserContext(
        12L, "manager", "sess-12", Set.of("outlet_manager"), Set.of(), Set.of(2000L), true, false, null
    ));
    when(orgHierarchyCacheService.getOrLoad(any(), any())).thenReturn(sampleHierarchy());

    OrgService service = new OrgService(orgRepository, orgHierarchyCacheService, kafkaEventPublisher, clock);
    List<OrgDtos.OutletView> result = service.listOutlets(null);

    assertEquals(1, result.size());
    assertEquals(2000L, result.getFirst().id());
  }

  @Test
  void getOutletRejectsOutOfScopeOutletForNonAdmin() {
    RequestUserContextHolder.set(new RequestUserContext(
        12L, "manager", "sess-12", Set.of("outlet_manager"), Set.of(), Set.of(2000L), true, false, null
    ));
    OrgDtos.OutletView outlet = new OrgDtos.OutletView(
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
    );
    when(orgRepository.findOutletById(2001L)).thenReturn(Optional.of(outlet));

    OrgService service = new OrgService(orgRepository, orgHierarchyCacheService, kafkaEventPublisher, clock);

    assertThrows(ServiceException.class, () -> service.getOutlet(2001L));
  }

  @Test
  void getHierarchyOnlyReturnsVisibleRegionTreeForScopedUser() {
    RequestUserContextHolder.set(new RequestUserContext(
        12L, "manager", "sess-12", Set.of("outlet_manager"), Set.of(), Set.of(2000L), true, false, null
    ));
    when(orgHierarchyCacheService.getOrLoad(any(), any())).thenReturn(sampleHierarchy());

    OrgService service = new OrgService(orgRepository, orgHierarchyCacheService, kafkaEventPublisher, clock);
    OrgDtos.OrgHierarchyView result = service.getHierarchy();

    assertEquals(Set.of(1L, 10L), result.regions().stream().map(OrgDtos.RegionView::id).collect(java.util.stream.Collectors.toSet()));
    assertEquals(List.of(2000L), result.outlets().stream().map(OrgDtos.OutletView::id).toList());
  }

  @Test
  void getRegionAllowsAncestorOfScopedOutletButRejectsUnrelatedRegion() {
    RequestUserContextHolder.set(new RequestUserContext(
        12L, "manager", "sess-12", Set.of("outlet_manager"), Set.of(), Set.of(2000L), true, false, null
    ));
    when(orgHierarchyCacheService.getOrLoad(any(), any())).thenReturn(sampleHierarchy());
    when(orgRepository.findRegionByCode("VN")).thenReturn(Optional.of(sampleHierarchy().regions().getFirst()));
    when(orgRepository.findRegionByCode("US")).thenReturn(Optional.of(sampleHierarchy().regions().get(2)));

    OrgService service = new OrgService(orgRepository, orgHierarchyCacheService, kafkaEventPublisher, clock);

    assertEquals("VN", service.getRegion("VN").code());
    assertThrows(ServiceException.class, () -> service.getRegion("US"));
  }

  @Test
  void createOutletEvictsCacheAndPublishesEvent() {
    RequestUserContextHolder.set(new RequestUserContext(
        7L,
        "admin",
        "sess-admin",
        Set.of("admin"),
        Set.of(),
        Set.of(),
        true,
        false,
        null
    ));
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
    OrgDtos.OutletView outlet = new OrgDtos.OutletView(
        101L,
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
    when(orgRepository.createOutlet(request)).thenReturn(outlet);

    OrgService service = new OrgService(orgRepository, orgHierarchyCacheService, kafkaEventPublisher, clock);
    OrgDtos.OutletView result = service.createOutlet(request);

    verify(orgHierarchyCacheService).evict();
    verify(kafkaEventPublisher).publish(
        eq("fern.org.outlet-created"),
        eq("101"),
        eq("org.outlet.created"),
        any(OutletCreatedEvent.class)
    );
    assertEquals(101L, result.id());
  }

  @Test
  void upsertExchangeRateRejectsOutOfOrderCurrencyCodes() {
    RequestUserContextHolder.set(new RequestUserContext(
        7L, "admin", "sess-admin", Set.of("admin"), Set.of(), Set.of(), true, false, null
    ));
    OrgService service = new OrgService(orgRepository, orgHierarchyCacheService, kafkaEventPublisher, clock);

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
    RequestUserContextHolder.set(new RequestUserContext(
        7L, "admin", "sess-admin", Set.of("admin"), Set.of(), Set.of(), true, false, null
    ));
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

    OrgService service = new OrgService(orgRepository, orgHierarchyCacheService, kafkaEventPublisher, clock);
    OrgDtos.ExchangeRateView result = service.upsertExchangeRate(request);

    verify(kafkaEventPublisher).publish(
        eq("fern.org.exchange-rate-updated"),
        eq("EUR-USD"),
        eq("org.exchange_rate.updated"),
        any(ExchangeRateUpdatedEvent.class)
    );
    assertEquals(new BigDecimal("1.10"), result.rate());
  }

  private OrgHierarchyCacheService.CachedHierarchy sampleHierarchy() {
    List<OrgDtos.RegionView> regions = List.of(
        new OrgDtos.RegionView(1L, "VN", null, "VND", "Vietnam", "VAT", "Asia/Ho_Chi_Minh"),
        new OrgDtos.RegionView(10L, "VN-HCM", 1L, "VND", "Ho Chi Minh", "VAT", "Asia/Ho_Chi_Minh"),
        new OrgDtos.RegionView(100L, "US", null, "USD", "United States", "SALES", "America/New_York"),
        new OrgDtos.RegionView(101L, "US-NYC", 100L, "USD", "New York", "SALES", "America/New_York")
    );
    List<OrgDtos.OutletView> outlets = List.of(
        new OrgDtos.OutletView(
            2000L,
            10L,
            "VN-HCM-001",
            "Saigon Central Outlet",
            "active",
            "1 Nguyen Hue",
            "123",
            "hcm@example.com",
            LocalDate.parse("2026-01-01"),
            null
        ),
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
