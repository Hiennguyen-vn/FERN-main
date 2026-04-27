package com.dorabets.common.spring.auth;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.dorabets.common.auth.InternalServiceAuth;
import com.dorabets.common.config.RuntimeEnvironment;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;

class RequestAuthenticationFilterTest {

  private static final String JWT_SECRET = "test-jwt-secret-should-be-at-least-32-bytes";
  private static final String INTERNAL_TOKEN = "test-internal-token-should-be-at-least-32";

  @AfterEach
  void clearRuntimeEnvironment() {
    RuntimeEnvironment.clearTestArguments();
    RequestUserContextHolder.clear();
    OutletScopeContext.clear();
  }

  @Test
  void pairEndpointIsPublicButPairTokenRequiresAuthentication() {
    RequestAuthenticationFilter filter = new RequestAuthenticationFilter(
        new JwtTokenService(new ObjectMapper().findAndRegisterModules(), JWT_SECRET),
        new SpringInternalServiceAuth(INTERNAL_TOKEN),
        mock(AuthSessionService.class),
        mock(DeviceTokenRegistry.class)
    );

    HttpServletRequest pairRequest = mock(HttpServletRequest.class);
    when(pairRequest.getRequestURI()).thenReturn("/api/v1/devices/pair");
    assertTrue(filter.shouldNotFilter(pairRequest));

    HttpServletRequest pairStatusRequest = mock(HttpServletRequest.class);
    when(pairStatusRequest.getRequestURI()).thenReturn("/api/v1/devices/pair/status");
    assertTrue(filter.shouldNotFilter(pairStatusRequest));

    HttpServletRequest pairTokenRequest = mock(HttpServletRequest.class);
    when(pairTokenRequest.getRequestURI()).thenReturn("/api/v1/devices/pair-token");
    assertFalse(filter.shouldNotFilter(pairTokenRequest));
  }

  @Test
  void multiOutletScopeFormatsAllowedOutletIdsWithoutPrimaryOutlet() {
    OutletScopeContext.setAllowedOutletIds(java.util.Set.of(20L, 10L));

    assertEquals("unset", OutletScopeContext.gucValue());
    assertEquals("10,20", OutletScopeContext.gucOutletIdsValue());
  }

  @Test
  void gatewayForwardedUserContextStaysUserScoped() throws Exception {
    RuntimeEnvironment.setTestArguments(java.util.List.of(), java.util.List.of("--dev"));
    AuthSessionService authSessionService = mock(AuthSessionService.class);
    RequestAuthenticationFilter filter = new RequestAuthenticationFilter(
        new JwtTokenService(new ObjectMapper().findAndRegisterModules(), JWT_SECRET),
        new SpringInternalServiceAuth(INTERNAL_TOKEN),
        authSessionService,
        mock(DeviceTokenRegistry.class)
    );

    HttpServletRequest request = mock(HttpServletRequest.class);
    when(request.getHeader(InternalServiceAuth.HEADER_SERVICE_NAME)).thenReturn("gateway");
    when(request.getHeader(InternalServiceAuth.HEADER_SERVICE_TOKEN)).thenReturn(INTERNAL_TOKEN);
    when(request.getHeader(InternalServiceAuth.HEADER_USER_ID)).thenReturn("1001");
    when(request.getHeader(InternalServiceAuth.HEADER_SESSION_ID)).thenReturn("session-1");
    when(request.getHeader(InternalServiceAuth.HEADER_ROLES)).thenReturn("manager");
    when(request.getHeader(InternalServiceAuth.HEADER_PERMISSIONS)).thenReturn("report.read");
    when(request.getHeader("X-Internal-Outlet-Ids")).thenReturn("2000");

    AtomicReference<RequestUserContext> contextRef = new AtomicReference<>();
    FilterChain chain = (req, res) -> contextRef.set(RequestUserContextHolder.get());

    filter.doFilterInternal(request, mock(HttpServletResponse.class), chain);

    RequestUserContext context = contextRef.get();
    assertEquals(1001L, context.userId());
    assertEquals("gateway", context.callerService());
    assertTrue(context.authenticated());
    assertFalse(context.internalService());
    assertTrue(context.outletIds().contains(2000L));
    assertTrue(context.hasRole("manager"));
    assertTrue(context.hasPermission("report.read"));
    verify(authSessionService).requireActiveSession("session-1", 1001L);
  }

  @Test
  void nonGatewayInternalServiceRemainsPrivilegedInternalCaller() throws Exception {
    RuntimeEnvironment.setTestArguments(java.util.List.of(), java.util.List.of("--dev"));
    RequestAuthenticationFilter filter = new RequestAuthenticationFilter(
        new JwtTokenService(new ObjectMapper().findAndRegisterModules(), JWT_SECRET),
        new SpringInternalServiceAuth(INTERNAL_TOKEN),
        mock(AuthSessionService.class),
        mock(DeviceTokenRegistry.class)
    );

    HttpServletRequest request = mock(HttpServletRequest.class);
    when(request.getHeader(InternalServiceAuth.HEADER_SERVICE_NAME)).thenReturn("inventory-service");
    when(request.getHeader(InternalServiceAuth.HEADER_SERVICE_TOKEN)).thenReturn(INTERNAL_TOKEN);
    when(request.getHeader(InternalServiceAuth.HEADER_USER_ID)).thenReturn("1001");
    when(request.getHeader(InternalServiceAuth.HEADER_SESSION_ID)).thenReturn("session-2");
    when(request.getHeader(InternalServiceAuth.HEADER_ROLES)).thenReturn("system");
    when(request.getHeader(InternalServiceAuth.HEADER_PERMISSIONS)).thenReturn("inventory.adjust");
    when(request.getHeader("X-Internal-Outlet-Ids")).thenReturn("2000");

    AtomicReference<RequestUserContext> contextRef = new AtomicReference<>();
    FilterChain chain = (req, res) -> contextRef.set(RequestUserContextHolder.get());

    filter.doFilterInternal(request, mock(HttpServletResponse.class), chain);

    RequestUserContext context = contextRef.get();
    assertEquals(1001L, context.userId());
    assertEquals("inventory-service", context.callerService());
    assertTrue(context.authenticated());
    assertTrue(context.internalService());
  }

  @Test
  void userJwtCannotReachSyncEndpointDirectly() throws Exception {
    JwtTokenService jwtTokenService = new JwtTokenService(new ObjectMapper().findAndRegisterModules(), JWT_SECRET);
    AuthSessionService authSessionService = mock(AuthSessionService.class);
    RequestAuthenticationFilter filter = new RequestAuthenticationFilter(
        jwtTokenService,
        new SpringInternalServiceAuth(INTERNAL_TOKEN),
        authSessionService,
        mock(DeviceTokenRegistry.class)
    );

    String token = jwtTokenService.issueAccessToken(
        1001L,
        "cashier",
        "session-1001",
        java.util.Set.of("staff"),
        java.util.Set.of("sales.order.write"),
        java.util.Set.of(7L),
        3600
    );

    HttpServletRequest request = mock(HttpServletRequest.class);
    when(request.getRequestURI()).thenReturn("/api/v1/sync/push");
    when(request.getHeader(HttpHeaders.AUTHORIZATION)).thenReturn("Bearer " + token);
    HttpServletResponse response = mock(HttpServletResponse.class);
    StringWriter responseBody = new StringWriter();
    when(response.getWriter()).thenReturn(new PrintWriter(responseBody));
    java.util.concurrent.atomic.AtomicBoolean chainInvoked = new java.util.concurrent.atomic.AtomicBoolean(false);
    FilterChain chain = (req, res) -> chainInvoked.set(true);

    filter.doFilterInternal(request, response, chain);

    verify(response).setStatus(HttpServletResponse.SC_FORBIDDEN);
    assertFalse(chainInvoked.get());
    org.mockito.Mockito.verifyNoInteractions(authSessionService);
  }

  @Test
  void posDeviceInternalContextCanReachSyncEndpointWithDeviceScope() throws Exception {
    RuntimeEnvironment.setTestArguments(java.util.List.of(), java.util.List.of("--dev"));
    RequestAuthenticationFilter filter = new RequestAuthenticationFilter(
        new JwtTokenService(new ObjectMapper().findAndRegisterModules(), JWT_SECRET),
        new SpringInternalServiceAuth(INTERNAL_TOKEN),
        mock(AuthSessionService.class),
        mock(DeviceTokenRegistry.class)
    );

    HttpServletRequest request = mock(HttpServletRequest.class);
    when(request.getRequestURI()).thenReturn("/api/v1/sync/pull/stock");
    when(request.getHeader(InternalServiceAuth.HEADER_SERVICE_NAME)).thenReturn("pos-device");
    when(request.getHeader(InternalServiceAuth.HEADER_SERVICE_TOKEN)).thenReturn(INTERNAL_TOKEN);
    when(request.getHeader("X-Internal-Device-Id")).thenReturn("55");
    when(request.getHeader("X-Internal-Device-Outlet-Id")).thenReturn("7");

    AtomicReference<RequestUserContext> contextRef = new AtomicReference<>();
    AtomicReference<String> outletScopeRef = new AtomicReference<>();
    FilterChain chain = (req, res) -> {
      contextRef.set(RequestUserContextHolder.get());
      outletScopeRef.set(OutletScopeContext.gucValue());
    };

    filter.doFilterInternal(request, mock(HttpServletResponse.class), chain);

    RequestUserContext context = contextRef.get();
    assertTrue(context.isDeviceContext());
    assertEquals(55L, context.deviceId());
    assertEquals(7L, context.deviceOutletId());
    assertEquals("7", outletScopeRef.get());
  }
}
