package com.fern.gateway.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.dorabets.common.auth.InternalServiceAuth;
import com.dorabets.common.spring.auth.AuthSessionService;
import com.dorabets.common.config.RuntimeEnvironment;
import com.dorabets.common.spring.auth.JwtTokenService;
import com.dorabets.common.spring.auth.SpringInternalServiceAuth;
import com.dorabets.common.spring.web.CorrelationIdFilter;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpCookie;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpMethod;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import reactor.core.publisher.Mono;

class GatewayAuthenticationFilterTest {

  private static final String JWT_SECRET = "test-jwt-secret-should-be-at-least-32-bytes";
  private static final String INTERNAL_TOKEN = "test-internal-token-should-be-at-least-32";
  private static final String AUTH_COOKIE_NAME = "dorabets_session";

  @AfterEach
  void clearRuntimeEnvironment() {
    RuntimeEnvironment.clearTestArguments();
  }

  @Test
  void publicPathsBypassJwtAndStripSpoofedInternalHeaders() {
    GatewayAuthenticationFilter filter = new GatewayAuthenticationFilter(
        new JwtTokenService(new ObjectMapper().findAndRegisterModules(), JWT_SECRET),
        new SpringInternalServiceAuth(INTERNAL_TOKEN),
        Mockito.mock(AuthSessionService.class),
        AUTH_COOKIE_NAME
    );

    MockServerHttpRequest request = MockServerHttpRequest.get("/api/v1/auth/login")
        .header(InternalServiceAuth.HEADER_SERVICE_NAME, "spoofed-service")
        .header(InternalServiceAuth.HEADER_USER_ID, "999")
        .header(CorrelationIdFilter.HEADER, "trace-public-1")
        .build();
    MockServerWebExchange exchange = MockServerWebExchange.from(request);
    AtomicReference<ServerHttpRequest> forwarded = new AtomicReference<>();

    filter.filter(exchange, currentExchange -> {
      forwarded.set(currentExchange.getRequest());
      return Mono.empty();
    }).block();

    ServerHttpRequest forwardedRequest = forwarded.get();
    assertNotNull(forwardedRequest);
    assertNull(forwardedRequest.getHeaders().getFirst(InternalServiceAuth.HEADER_SERVICE_NAME));
    assertNull(forwardedRequest.getHeaders().getFirst(InternalServiceAuth.HEADER_USER_ID));
    assertEquals("trace-public-1", forwardedRequest.getHeaders().getFirst(CorrelationIdFilter.HEADER));
    assertEquals("gateway", forwardedRequest.getHeaders().getFirst("X-Forwarded-By"));
  }

  @Test
  void publicPosPathsBypassJwtAndRemainPublic() {
    GatewayAuthenticationFilter filter = new GatewayAuthenticationFilter(
        new JwtTokenService(new ObjectMapper().findAndRegisterModules(), JWT_SECRET),
        new SpringInternalServiceAuth(INTERNAL_TOKEN),
        Mockito.mock(AuthSessionService.class),
        AUTH_COOKIE_NAME
    );

    MockServerHttpRequest request = MockServerHttpRequest.get("/api/v1/sales/public/tables/tbl_hcm1_u7k29q")
        .header(InternalServiceAuth.HEADER_SERVICE_NAME, "spoofed-service")
        .header(InternalServiceAuth.HEADER_USER_ID, "999")
        .build();
    MockServerWebExchange exchange = MockServerWebExchange.from(request);
    AtomicReference<ServerHttpRequest> forwarded = new AtomicReference<>();

    filter.filter(exchange, currentExchange -> {
      forwarded.set(currentExchange.getRequest());
      return Mono.empty();
    }).block();

    ServerHttpRequest forwardedRequest = forwarded.get();
    assertNotNull(forwardedRequest);
    assertNull(forwardedRequest.getHeaders().getFirst(InternalServiceAuth.HEADER_SERVICE_NAME));
    assertNull(forwardedRequest.getHeaders().getFirst(InternalServiceAuth.HEADER_USER_ID));
    assertEquals("gateway", forwardedRequest.getHeaders().getFirst("X-Forwarded-By"));
  }

  @Test
  void protectedPathsReturnUnauthorizedWithoutBearerToken() {
    GatewayAuthenticationFilter filter = new GatewayAuthenticationFilter(
        new JwtTokenService(new ObjectMapper().findAndRegisterModules(), JWT_SECRET),
        new SpringInternalServiceAuth(INTERNAL_TOKEN),
        Mockito.mock(AuthSessionService.class),
        AUTH_COOKIE_NAME
    );

    MockServerWebExchange exchange = MockServerWebExchange.from(
        MockServerHttpRequest.get("/api/v1/products/route-probe").build()
    );
    AtomicBoolean chainInvoked = new AtomicBoolean(false);

    filter.filter(exchange, currentExchange -> {
      chainInvoked.set(true);
      return Mono.empty();
    }).block();

    assertEquals(HttpStatus.UNAUTHORIZED, exchange.getResponse().getStatusCode());
    assertFalse(chainInvoked.get());
  }

  @Test
  void controlPlanePathsAreProtectedWithoutBearerToken() {
    GatewayAuthenticationFilter filter = new GatewayAuthenticationFilter(
        new JwtTokenService(new ObjectMapper().findAndRegisterModules(), JWT_SECRET),
        new SpringInternalServiceAuth(INTERNAL_TOKEN),
        Mockito.mock(AuthSessionService.class),
        AUTH_COOKIE_NAME
    );

    MockServerWebExchange exchange = MockServerWebExchange.from(
        MockServerHttpRequest.get("/api/v1/control/services").build()
    );
    AtomicBoolean chainInvoked = new AtomicBoolean(false);

    filter.filter(exchange, currentExchange -> {
      chainInvoked.set(true);
      return Mono.empty();
    }).block();

    assertEquals(HttpStatus.UNAUTHORIZED, exchange.getResponse().getStatusCode());
    assertFalse(chainInvoked.get());
  }

  @Test
  void validInternalServiceHeadersCanReachControlPlanePaths() {
    RuntimeEnvironment.setTestArguments(java.util.List.of(), java.util.List.of("--dev"));
    GatewayAuthenticationFilter filter = new GatewayAuthenticationFilter(
        new JwtTokenService(new ObjectMapper().findAndRegisterModules(), JWT_SECRET),
        new SpringInternalServiceAuth(INTERNAL_TOKEN),
        Mockito.mock(AuthSessionService.class),
        AUTH_COOKIE_NAME
    );

    MockServerHttpRequest request = MockServerHttpRequest.post("/api/v1/control/services/register")
        .header(InternalServiceAuth.HEADER_SERVICE_NAME, "infra-smoke")
        .header(InternalServiceAuth.HEADER_SERVICE_TOKEN, INTERNAL_TOKEN)
        .header(InternalServiceAuth.HEADER_USER_ID, "999")
        .header(InternalServiceAuth.HEADER_PERMISSIONS, "probe")
        .build();
    MockServerWebExchange exchange = MockServerWebExchange.from(request);
    AtomicReference<ServerHttpRequest> forwarded = new AtomicReference<>();

    filter.filter(exchange, currentExchange -> {
      forwarded.set(currentExchange.getRequest());
      return Mono.empty();
    }).block();

    ServerHttpRequest forwardedRequest = forwarded.get();
    assertNotNull(forwardedRequest);
    assertEquals("infra-smoke", forwardedRequest.getHeaders().getFirst(InternalServiceAuth.HEADER_SERVICE_NAME));
    assertEquals(INTERNAL_TOKEN,
        forwardedRequest.getHeaders().getFirst(InternalServiceAuth.HEADER_SERVICE_TOKEN));
    assertEquals("999", forwardedRequest.getHeaders().getFirst(InternalServiceAuth.HEADER_USER_ID));
    assertEquals("probe", forwardedRequest.getHeaders().getFirst(InternalServiceAuth.HEADER_PERMISSIONS));
    assertEquals("gateway", forwardedRequest.getHeaders().getFirst("X-Forwarded-By"));
    assertNull(exchange.getResponse().getStatusCode());
  }

  @Test
  void corsPreflightBypassesJwtEnforcement() {
    GatewayAuthenticationFilter filter = new GatewayAuthenticationFilter(
        new JwtTokenService(new ObjectMapper().findAndRegisterModules(), JWT_SECRET),
        new SpringInternalServiceAuth(INTERNAL_TOKEN),
        Mockito.mock(AuthSessionService.class),
        AUTH_COOKIE_NAME
    );

    MockServerHttpRequest request = MockServerHttpRequest.method(HttpMethod.OPTIONS, "/api/v1/auth/me")
        .header(HttpHeaders.ORIGIN, "http://localhost:5173")
        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "GET")
        .build();
    MockServerWebExchange exchange = MockServerWebExchange.from(request);
    AtomicBoolean chainInvoked = new AtomicBoolean(false);

    filter.filter(exchange, currentExchange -> {
      chainInvoked.set(true);
      return Mono.empty();
    }).block();

    assertTrue(chainInvoked.get());
    assertNull(exchange.getResponse().getStatusCode());
  }

  @Test
  void validJwtAddsTrustedInternalHeadersAndStripsSpoofedOnes() {
    RuntimeEnvironment.setTestArguments(java.util.List.of(), java.util.List.of("--dev"));
    JwtTokenService jwtTokenService = new JwtTokenService(new ObjectMapper().findAndRegisterModules(), JWT_SECRET);
    AuthSessionService authSessionService = Mockito.mock(AuthSessionService.class);
    GatewayAuthenticationFilter filter = new GatewayAuthenticationFilter(
        jwtTokenService,
        new SpringInternalServiceAuth(INTERNAL_TOKEN),
        authSessionService,
        AUTH_COOKIE_NAME
    );

    String token = jwtTokenService.issueAccessToken(
        1001L,
        "fern-dev-admin",
        "fern-dev-session",
        Set.of("admin"),
        Set.of("product.catalog.write"),
        Set.of(7L),
        3600
    );

    MockServerHttpRequest request = MockServerHttpRequest.get("/api/v1/products/route-probe")
        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
        .header(InternalServiceAuth.HEADER_SERVICE_NAME, "spoofed-service")
        .header(InternalServiceAuth.HEADER_SERVICE_TOKEN, "spoofed-token")
        .header(InternalServiceAuth.HEADER_USER_ID, "999")
        .build();
    MockServerWebExchange exchange = MockServerWebExchange.from(request);
    AtomicReference<ServerHttpRequest> forwarded = new AtomicReference<>();

    filter.filter(exchange, currentExchange -> {
      forwarded.set(currentExchange.getRequest());
      return Mono.empty();
    }).block();

    ServerHttpRequest forwardedRequest = forwarded.get();
    assertNotNull(forwardedRequest);
    assertEquals("gateway", forwardedRequest.getHeaders().getFirst(InternalServiceAuth.HEADER_SERVICE_NAME));
    assertEquals(INTERNAL_TOKEN,
        forwardedRequest.getHeaders().getFirst(InternalServiceAuth.HEADER_SERVICE_TOKEN));
    assertEquals("1001", forwardedRequest.getHeaders().getFirst(InternalServiceAuth.HEADER_USER_ID));
    assertEquals("fern-dev-session", forwardedRequest.getHeaders().getFirst(InternalServiceAuth.HEADER_SESSION_ID));
    assertEquals("admin", forwardedRequest.getHeaders().getFirst(InternalServiceAuth.HEADER_ROLES));
    assertEquals("product.catalog.write",
        forwardedRequest.getHeaders().getFirst(InternalServiceAuth.HEADER_PERMISSIONS));
    assertEquals("7", forwardedRequest.getHeaders().getFirst("X-Internal-Outlet-Ids"));
    assertEquals("gateway", forwardedRequest.getHeaders().getFirst("X-Forwarded-By"));
    assertFalse(forwardedRequest.getHeaders().getFirst(CorrelationIdFilter.HEADER).isBlank());
    assertTrue(forwardedRequest.getHeaders().containsKey(InternalServiceAuth.HEADER_SERVICE_TOKEN));
    Mockito.verify(authSessionService).requireActiveSession("fern-dev-session", 1001L);
  }

  @Test
  void validSessionCookieAddsTrustedInternalHeaders() {
    JwtTokenService jwtTokenService = new JwtTokenService(new ObjectMapper().findAndRegisterModules(), JWT_SECRET);
    AuthSessionService authSessionService = Mockito.mock(AuthSessionService.class);
    GatewayAuthenticationFilter filter = new GatewayAuthenticationFilter(
        jwtTokenService,
        new SpringInternalServiceAuth(INTERNAL_TOKEN),
        authSessionService,
        AUTH_COOKIE_NAME
    );

    String token = jwtTokenService.issueAccessToken(
        2002L,
        "cookie-user",
        "cookie-session",
        Set.of("outlet_manager"),
        Set.of("sales.order.write"),
        Set.of(9L),
        3600
    );

    MockServerHttpRequest request = MockServerHttpRequest.get("/api/v1/sales/orders")
        .cookie(new HttpCookie(AUTH_COOKIE_NAME, token))
        .build();
    MockServerWebExchange exchange = MockServerWebExchange.from(request);
    AtomicReference<ServerHttpRequest> forwarded = new AtomicReference<>();

    filter.filter(exchange, currentExchange -> {
      forwarded.set(currentExchange.getRequest());
      return Mono.empty();
    }).block();

    ServerHttpRequest forwardedRequest = forwarded.get();
    assertNotNull(forwardedRequest);
    assertEquals("gateway", forwardedRequest.getHeaders().getFirst(InternalServiceAuth.HEADER_SERVICE_NAME));
    assertEquals("2002", forwardedRequest.getHeaders().getFirst(InternalServiceAuth.HEADER_USER_ID));
    assertEquals("cookie-session", forwardedRequest.getHeaders().getFirst(InternalServiceAuth.HEADER_SESSION_ID));
    assertEquals("sales.order.write", forwardedRequest.getHeaders().getFirst(InternalServiceAuth.HEADER_PERMISSIONS));
    assertEquals("9", forwardedRequest.getHeaders().getFirst("X-Internal-Outlet-Ids"));
    Mockito.verify(authSessionService).requireActiveSession("cookie-session", 2002L);
  }
}
