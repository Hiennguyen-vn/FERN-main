package com.fern.services.masternode;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.fern.services.masternode.api.ControlPlaneDtos;
import com.fern.services.masternode.application.ControlPlaneRegistryService;
import com.fern.services.masternode.infrastructure.ControlPlanePersistenceRepository;
import com.fern.services.masternode.infrastructure.ControlPlaneRedisStore;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.Test;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class ControlPlaneRegistryServiceTest {

  @Mock
  private SnowflakeIdGenerator idGenerator;
  @Mock
  private ControlPlanePersistenceRepository repository;
  @Mock
  private ControlPlaneRedisStore redisStore;

  @AfterEach
  void clearContext() {
    RequestUserContextHolder.clear();
  }

  @Test
  void registerCreatesActiveInstanceAndConfig() {
    setInternalContext("inventory-service");
    MutableClock clock = new MutableClock(Instant.parse("2026-03-26T00:00:00Z"));
    ControlPlaneRegistryService service = new ControlPlaneRegistryService(
        clock,
        Duration.ofSeconds(30),
        Duration.ofSeconds(10),
        1L
    );

    ControlPlaneDtos.ServiceRegistrationResponse response = service.register(
        new ControlPlaneDtos.ServiceRegistrationRequest(
            1001L,
            "sales-service",
            "0.1.0-SNAPSHOT",
            "spring-boot",
            "sales-service",
            8087,
            List.of("VN"),
            List.of(2001L),
            List.of("sales.write"),
            Map.of("buildSha", "abc123")
        )
    );

    assertEquals(1001L, response.instanceId());
    assertEquals("/api/v1/control/services/1001/heartbeat", response.heartbeatPath());
    assertEquals(1L, service.getConfig("sales-service").configVersion());
    assertEquals(1, service.listServices().size());
    assertTrue(service.listInstances("sales-service", null, null, null).getFirst().active());
  }

  @Test
  void durableRegisterReturnsImplementedHeartbeatPath() {
    setInternalContext("sales-service");
    Clock clock = Clock.fixed(Instant.parse("2026-03-26T00:00:00Z"), ZoneOffset.UTC);
    when(repository.ensureDefaultConfig(eq("sales-service"), any())).thenReturn(7L);
    when(repository.upsertInstance(eq(2002L), any(), any(), eq("UP"))).thenReturn(2002L);

    ControlPlaneRegistryService service = new ControlPlaneRegistryService(
        clock,
        idGenerator,
        repository,
        redisStore,
        30L,
        10L
    );

    ControlPlaneDtos.ServiceRegistrationResponse response = service.register(
        new ControlPlaneDtos.ServiceRegistrationRequest(
            2002L,
            "sales-service",
            "0.1.0-SNAPSHOT",
            "spring-boot",
            "sales-service",
            8087,
            List.of("VN"),
            List.of(2001L),
            List.of("sales.write"),
            Map.of("buildSha", "abc123")
        )
    );

    assertEquals("/api/v1/control/services/2002/heartbeat", response.heartbeatPath());
  }

  @Test
  void staleHeartbeatMarksInstanceDown() {
    setInternalContext("inventory-service");
    MutableClock clock = new MutableClock(Instant.parse("2026-03-26T00:00:00Z"));
    ControlPlaneRegistryService service = new ControlPlaneRegistryService(
        clock,
        Duration.ofSeconds(30),
        Duration.ofSeconds(10),
        1L
    );

    service.register(
        new ControlPlaneDtos.ServiceRegistrationRequest(
            1002L,
            "inventory-service",
            "0.1.0-SNAPSHOT",
            "spring-boot",
            "inventory-service",
            8088,
            List.of("VN"),
            List.of(2001L),
            List.of("inventory.write"),
            Map.of()
        )
    );

    clock.advance(Duration.ofSeconds(31));

    ControlPlaneDtos.SystemHealthResponse health = service.systemHealth();
    assertEquals("DEGRADED", health.status());
    assertEquals(1L, health.downInstances());
    assertFalse(service.listInstances("inventory-service", null, null, null).getFirst().active());
  }

  @Test
  void registerRejectsAnonymousCaller() {
    MutableClock clock = new MutableClock(Instant.parse("2026-03-26T00:00:00Z"));
    ControlPlaneRegistryService service = new ControlPlaneRegistryService(
        clock,
        Duration.ofSeconds(30),
        Duration.ofSeconds(10),
        1L
    );

    ServiceException exception = assertThrows(ServiceException.class, () -> service.register(
        new ControlPlaneDtos.ServiceRegistrationRequest(
            1001L,
            "sales-service",
            "0.1.0-SNAPSHOT",
            "spring-boot",
            "sales-service",
            8087,
            List.of("VN"),
            List.of(2001L),
            List.of("sales.write"),
            Map.of()
        )
    ));

    assertEquals(401, exception.getStatusCode());
  }

  @Test
  void listServicesAllowsAdminUser() {
    RequestUserContextHolder.set(new RequestUserContext(
        3010L,
        "workflow.admin",
        "session-admin",
        Set.of("admin"),
        Set.of(),
        Set.of(2000L),
        true,
        false,
        null
    ));
    MutableClock clock = new MutableClock(Instant.parse("2026-03-26T00:00:00Z"));
    ControlPlaneRegistryService service = new ControlPlaneRegistryService(
        clock,
        Duration.ofSeconds(30),
        Duration.ofSeconds(10),
        1L
    );
    setInternalContext("sales-service");
    service.register(
        new ControlPlaneDtos.ServiceRegistrationRequest(
            1001L,
            "sales-service",
            "0.1.0-SNAPSHOT",
            "spring-boot",
            "sales-service",
            8087,
            List.of("VN"),
            List.of(2001L),
            List.of("sales.write"),
            Map.of()
        )
    );

    RequestUserContextHolder.set(new RequestUserContext(
        3010L,
        "workflow.admin",
        "session-admin",
        Set.of("admin"),
        Set.of(),
        Set.of(2000L),
        true,
        false,
        null
    ));
    assertEquals(1, service.listServices().size());
  }

  private static void setInternalContext(String callerService) {
    RequestUserContextHolder.set(new RequestUserContext(
        null,
        null,
        null,
        Set.of(),
        Set.of(),
        Set.of(),
        false,
        true,
        callerService
    ));
  }

  private static final class MutableClock extends Clock {

    private Instant instant;

    private MutableClock(Instant instant) {
      this.instant = instant;
    }

    @Override
    public ZoneOffset getZone() {
      return ZoneOffset.UTC;
    }

    @Override
    public Clock withZone(java.time.ZoneId zone) {
      return this;
    }

    @Override
    public Instant instant() {
      return instant;
    }

    private void advance(Duration duration) {
      instant = instant.plus(duration);
    }
  }
}
