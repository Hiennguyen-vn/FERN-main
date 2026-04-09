package com.fern.services.auth.spring.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.AuthSessionRepository;
import com.dorabets.common.spring.auth.AuthSessionService;
import com.dorabets.common.spring.auth.JwtClaims;
import com.dorabets.common.spring.auth.JwtTokenService;
import com.dorabets.common.spring.auth.PermissionMatrix;
import com.dorabets.common.spring.auth.PermissionMatrixService;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.dorabets.common.spring.events.TypedKafkaEventPublisher;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fern.events.auth.RoleUpdatedEvent;
import com.fern.events.auth.UserCreatedEvent;
import com.fern.services.auth.spring.api.AuthDtos;
import com.fern.services.auth.spring.infrastructure.AuthUserRepository;
import com.fern.services.auth.spring.infrastructure.AuthUserRepository.AuthUserRecord;
import com.fern.services.auth.spring.infrastructure.AuthUserRepository.CreateUserCommand;
import com.fern.services.auth.spring.infrastructure.AuthUserRepository.RolePermissionUpdateResult;
import jakarta.servlet.http.HttpServletRequest;
import com.natsu.common.utils.security.PasswordUtil;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class AuthServiceTest {

  private static final String JWT_SECRET = "test-jwt-secret-should-be-at-least-32-bytes";

  @Mock
  private AuthUserRepository authUserRepository;
  @Mock
  private PermissionMatrixService permissionMatrixService;
  @Mock
  private AuthSessionService authSessionService;
  @Mock
  private TypedKafkaEventPublisher kafkaEventPublisher;

  private final Clock clock = Clock.fixed(Instant.parse("2026-03-27T00:00:00Z"), ZoneOffset.UTC);
  private final JwtTokenService jwtTokenService =
      new JwtTokenService(new ObjectMapper().findAndRegisterModules(), JWT_SECRET);

  @AfterEach
  void clearContext() {
    RequestUserContextHolder.clear();
  }

  @Test
  void loginIssuesJwtWithExpectedClaims() throws Exception {
    AuthUserRecord user = new AuthUserRecord(
        42L,
        "alice",
        PasswordUtil.hash("s3cret"),
        "Alice Example",
        "EMP-42",
        "alice@example.com",
        "active",
        Instant.parse("2026-03-26T00:00:00Z"),
        Instant.parse("2026-03-27T00:00:00Z")
    );
    PermissionMatrix matrix = new PermissionMatrix(
        42L,
        Map.of(7L, Set.of("sales.order.write")),
        Map.of(7L, Set.of("admin"))
    );
    when(authUserRepository.findByUsername("alice")).thenReturn(Optional.of(user));
    when(permissionMatrixService.load(42L)).thenReturn(matrix);
    when(authSessionService.openSession(eq(42L), eq(900L), any(), any()))
        .thenReturn(sessionRecord("session-42", 42L, "2026-03-27T00:00:00Z", "2026-03-27T00:15:00Z"));

    AuthService service = new AuthService(
        authUserRepository,
        permissionMatrixService,
        jwtTokenService,
        authSessionService,
        kafkaEventPublisher,
        clock,
        900L
    );

    HttpServletRequest httpRequest = mock(HttpServletRequest.class);
    when(httpRequest.getHeader("User-Agent")).thenReturn("Vitest Browser");
    when(httpRequest.getRemoteAddr()).thenReturn("127.0.0.1");

    AuthDtos.LoginResponse response = service.login(new AuthDtos.LoginRequest("alice", "s3cret"), httpRequest);
    JwtClaims claims = jwtTokenService.verify(response.accessToken());

    assertEquals(42L, claims.userId());
    assertEquals("alice", claims.username());
    assertEquals("session-42", claims.sessionId());
    assertEquals(Set.of("admin"), claims.roles());
    assertEquals(Set.of("sales.order.write"), claims.permissions());
    assertEquals(Set.of(7L), claims.outletIds());
    assertEquals(900L, response.expiresInSeconds());
    assertEquals("session-42", response.sessionId());
  }

  @Test
  void loginRejectsInvalidPassword() throws Exception {
    AuthUserRecord user = new AuthUserRecord(
        42L,
        "alice",
        PasswordUtil.hash("s3cret"),
        "Alice Example",
        "EMP-42",
        "alice@example.com",
        "active",
        Instant.parse("2026-03-26T00:00:00Z"),
        Instant.parse("2026-03-27T00:00:00Z")
    );
    when(authUserRepository.findByUsername("alice")).thenReturn(Optional.of(user));

    AuthService service = new AuthService(
        authUserRepository,
        permissionMatrixService,
        jwtTokenService,
        authSessionService,
        kafkaEventPublisher,
        clock,
        900L
    );

    HttpServletRequest httpRequest = mock(HttpServletRequest.class);
    assertThrows(ServiceException.class, () -> service.login(new AuthDtos.LoginRequest("alice", "wrong"), httpRequest));
    verify(authSessionService, never()).openSession(any(Long.class), any(Long.class), any(), any());
  }

  @Test
  void meReturnsAuthenticatedUserSummaryAndPermissionMatrix() {
    RequestUserContextHolder.set(new RequestUserContext(
        42L,
        "alice",
        "sess-42",
        Set.of("admin"),
        Set.of("sales.order.write"),
        Set.of(7L),
        true,
        false,
        null
    ));
    AuthUserRecord user = new AuthUserRecord(
        42L,
        "alice",
        "hash",
        "Alice Example",
        "EMP-42",
        "alice@example.com",
        "active",
        Instant.parse("2026-03-26T00:00:00Z"),
        Instant.parse("2026-03-27T00:00:00Z")
    );
    PermissionMatrix matrix = new PermissionMatrix(
        42L,
        Map.of(7L, Set.of("sales.order.write")),
        Map.of(7L, Set.of("admin"))
    );
    when(authUserRepository.findById(42L)).thenReturn(Optional.of(user));
    when(permissionMatrixService.load(42L)).thenReturn(matrix);
    when(authSessionService.getRequiredSession("sess-42", 42L))
        .thenReturn(sessionRecord("sess-42", 42L, "2026-03-27T00:00:00Z", "2026-03-27T00:10:00Z"));

    AuthService service = new AuthService(
        authUserRepository,
        permissionMatrixService,
        jwtTokenService,
        authSessionService,
        kafkaEventPublisher,
        clock,
        600L
    );

    AuthDtos.MeResponse response = service.me();

    assertEquals("alice", response.user().username());
    assertEquals(Set.of("admin"), response.rolesByOutlet().get(7L));
    assertEquals("sess-42", response.sessionId());
    assertEquals(Instant.parse("2026-03-27T00:00:00Z"), response.issuedAt());
    assertEquals(Instant.parse("2026-03-27T00:10:00Z"), response.expiresAt());
  }

  @Test
  void refreshRotatesTheCurrentSessionAndIssuesANewJwt() {
    RequestUserContextHolder.set(new RequestUserContext(
        42L,
        "alice",
        "sess-42",
        Set.of("outlet_manager"),
        Set.of("sales.order.write"),
        Set.of(7L),
        true,
        false,
        null
    ));
    AuthUserRecord user = new AuthUserRecord(
        42L,
        "alice",
        "hash",
        "Alice Example",
        "EMP-42",
        "alice@example.com",
        "active",
        Instant.parse("2026-03-26T00:00:00Z"),
        Instant.parse("2026-03-27T00:00:00Z")
    );
    PermissionMatrix matrix = new PermissionMatrix(
        42L,
        Map.of(7L, Set.of("sales.order.write")),
        Map.of(7L, Set.of("outlet_manager"))
    );
    when(authUserRepository.findById(42L)).thenReturn(Optional.of(user));
    when(permissionMatrixService.load(42L)).thenReturn(matrix);
    when(authSessionService.refreshSession(eq("sess-42"), eq(42L), eq(600L), any(), any()))
        .thenReturn(sessionRecord("sess-99", 42L, "2026-03-27T00:05:00Z", "2026-03-27T00:15:00Z"));

    AuthService service = new AuthService(
        authUserRepository,
        permissionMatrixService,
        jwtTokenService,
        authSessionService,
        kafkaEventPublisher,
        clock,
        600L
    );

    HttpServletRequest httpRequest = mock(HttpServletRequest.class);
    when(httpRequest.getHeader("User-Agent")).thenReturn("Vitest Browser");
    when(httpRequest.getRemoteAddr()).thenReturn("127.0.0.1");

    AuthDtos.LoginResponse response = service.refresh(httpRequest);
    JwtClaims claims = jwtTokenService.verify(response.accessToken());

    assertEquals("sess-99", response.sessionId());
    assertEquals("sess-99", claims.sessionId());
  }

  @Test
  void logoutRevokesTheCurrentSession() {
    RequestUserContextHolder.set(new RequestUserContext(
        42L,
        "alice",
        "sess-42",
        Set.of("outlet_manager"),
        Set.of("sales.order.write"),
        Set.of(7L),
        true,
        false,
        null
    ));
    when(authSessionService.logoutSession("sess-42", 42L))
        .thenReturn(sessionRecord("sess-42", 42L, "2026-03-27T00:00:00Z", "2026-03-27T00:10:00Z",
            "2026-03-27T00:02:00Z"));

    AuthService service = new AuthService(
        authUserRepository,
        permissionMatrixService,
        jwtTokenService,
        authSessionService,
        kafkaEventPublisher,
        clock,
        600L
    );

    AuthDtos.LogoutResponse response = service.logout();
    assertEquals("sess-42", response.sessionId());
    assertEquals(Instant.parse("2026-03-27T00:02:00Z"), response.revokedAt());
  }

  @Test
  void listSessionsMarksTheCurrentSession() {
    RequestUserContextHolder.set(new RequestUserContext(
        42L,
        "alice",
        "sess-current",
        Set.of("outlet_manager"),
        Set.of("sales.order.write"),
        Set.of(7L),
        true,
        false,
        null
    ));
    when(authSessionService.listSessions(42L)).thenReturn(List.of(
        sessionRecord("sess-current", 42L, "2026-03-27T00:00:00Z", "2026-03-27T00:10:00Z"),
        sessionRecord("sess-old", 42L, "2026-03-26T00:00:00Z", "2026-03-26T00:10:00Z", "2026-03-26T00:05:00Z")
    ));

    AuthService service = new AuthService(
        authUserRepository,
        permissionMatrixService,
        jwtTokenService,
        authSessionService,
        kafkaEventPublisher,
        clock,
        600L
    );

    List<AuthDtos.SessionView> sessions = service.listSessions();
    assertEquals(2, sessions.size());
    assertEquals("sess-current", sessions.getFirst().sessionId());
    assertEquals("active", sessions.getFirst().state());
    assertEquals(true, sessions.getFirst().current());
    assertEquals("revoked", sessions.get(1).state());
  }

  @Test
  void revokeSessionOnlyAllowsOwnedSessions() {
    RequestUserContextHolder.set(new RequestUserContext(
        42L,
        "alice",
        "sess-current",
        Set.of("outlet_manager"),
        Set.of("sales.order.write"),
        Set.of(7L),
        true,
        false,
        null
    ));
    when(authSessionService.findSession("sess-other"))
        .thenReturn(Optional.of(sessionRecord("sess-other", 84L, "2026-03-26T00:00:00Z", "2026-03-26T00:10:00Z")));

    AuthService service = new AuthService(
        authUserRepository,
        permissionMatrixService,
        jwtTokenService,
        authSessionService,
        kafkaEventPublisher,
        clock,
        600L
    );

    assertThrows(ServiceException.class, () -> service.revokeSession("sess-other"));
  }

  @Test
  void createUserPublishesUserCreatedEvent() {
    RequestUserContextHolder.set(new RequestUserContext(
        7L,
        "admin",
        "sess-admin",
        Set.of("admin"),
        Set.of("auth.user.write"),
        Set.of(7L),
        true,
        false,
        null
    ));
    when(authUserRepository.countActiveUsers()).thenReturn(1L);
    when(authUserRepository.createUser(any(CreateUserCommand.class))).thenReturn(new AuthUserRecord(
        101L,
        "new.user",
        "hash",
        "New User",
        "EMP-101",
        "new.user@example.com",
        "active",
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-27T00:00:00Z")
    ));
    when(permissionMatrixService.load(101L)).thenReturn(new PermissionMatrix(
        101L,
        Map.of(7L, Set.of("sales.order.write")),
        Map.of(7L, Set.of("cashier"))
    ));

    AuthService service = new AuthService(
        authUserRepository,
        permissionMatrixService,
        jwtTokenService,
        authSessionService,
        kafkaEventPublisher,
        clock,
        3600L
    );

    AuthDtos.UserSummary summary = service.createUser(new AuthDtos.CreateUserRequest(
        " new.user ",
        "temporary-password",
        " New User ",
        " EMP-101 ",
        " new.user@example.com ",
        List.of(new AuthDtos.OutletAccessAssignment(7L, Set.of("cashier"), Set.of("sales.order.write")))
    ));

    ArgumentCaptor<CreateUserCommand> commandCaptor = ArgumentCaptor.forClass(CreateUserCommand.class);
    verify(authUserRepository).createUser(commandCaptor.capture());
    verify(kafkaEventPublisher).publish(
        eq("fern.auth.user-created"),
        eq("101"),
        eq("auth.user.created"),
        any(UserCreatedEvent.class)
    );
    assertEquals(101L, summary.id());
    assertEquals("new.user", commandCaptor.getValue().username());
    assertNotEquals("temporary-password", commandCaptor.getValue().passwordHash());
  }

  @Test
  void updateRolePermissionsPublishesRoleUpdatedEvent() {
    RequestUserContextHolder.set(new RequestUserContext(
        7L,
        "admin",
        "sess-admin",
        Set.of("admin"),
        Set.of("auth.role.write"),
        Set.of(),
        true,
        false,
        null
    ));
    when(authUserRepository.replaceRolePermissions("manager", Set.of("org.write", "product.catalog.write")))
        .thenReturn(new RolePermissionUpdateResult(
            "manager",
            Set.of("org.write", "product.catalog.write"),
            Instant.parse("2026-03-27T00:00:00Z")
        ));
    when(authUserRepository.findUserIdsByRoleCode("manager")).thenReturn(Set.of(101L, 102L));

    AuthService service = new AuthService(
        authUserRepository,
        permissionMatrixService,
        jwtTokenService,
        authSessionService,
        kafkaEventPublisher,
        clock,
        3600L
    );

    AuthDtos.RolePermissionsResponse response = service.updateRolePermissions(
        "manager",
        new AuthDtos.UpdateRolePermissionsRequest(Set.of("org.write", "product.catalog.write"))
    );

    verify(kafkaEventPublisher).publish(
        eq("fern.auth.role-updated"),
        eq("manager"),
        eq("auth.role.updated"),
        any(RoleUpdatedEvent.class)
    );
    verify(permissionMatrixService).evict(101L);
    verify(permissionMatrixService).evict(102L);
    assertEquals("manager", response.roleCode());
    assertEquals(Set.of("org.write", "product.catalog.write"), response.permissionCodes());
  }

  private static AuthSessionRepository.AuthSessionRecord sessionRecord(
      String sessionId,
      long userId,
      String issuedAt,
      String expiresAt
  ) {
    return sessionRecord(sessionId, userId, issuedAt, expiresAt, null);
  }

  private static AuthSessionRepository.AuthSessionRecord sessionRecord(
      String sessionId,
      long userId,
      String issuedAt,
      String expiresAt,
      String revokedAt
  ) {
    return new AuthSessionRepository.AuthSessionRecord(
        sessionId,
        userId,
        Instant.parse(issuedAt),
        Instant.parse(expiresAt),
        null,
        revokedAt == null ? null : Instant.parse(revokedAt),
        revokedAt == null ? null : userId,
        revokedAt == null ? null : "logout",
        "Vitest Browser",
        "127.0.0.1",
        Instant.parse(issuedAt),
        revokedAt == null ? Instant.parse(issuedAt) : Instant.parse(revokedAt)
    );
  }
}
