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
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class RequestAuthenticationFilterTest {

  private static final String JWT_SECRET = "test-jwt-secret-should-be-at-least-32-bytes";
  private static final String INTERNAL_TOKEN = "test-internal-token-should-be-at-least-32";

  @AfterEach
  void clearRuntimeEnvironment() {
    RuntimeEnvironment.clearTestArguments();
    RequestUserContextHolder.clear();
  }

  @Test
  void gatewayForwardedUserContextStaysUserScoped() throws Exception {
    RuntimeEnvironment.setTestArguments(java.util.List.of(), java.util.List.of("--dev"));
    AuthSessionService authSessionService = mock(AuthSessionService.class);
    RequestAuthenticationFilter filter = new RequestAuthenticationFilter(
        new JwtTokenService(new ObjectMapper().findAndRegisterModules(), JWT_SECRET),
        new SpringInternalServiceAuth(INTERNAL_TOKEN),
        authSessionService
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
        mock(AuthSessionService.class)
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
}
