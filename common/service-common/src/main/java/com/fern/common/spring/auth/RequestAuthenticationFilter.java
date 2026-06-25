package com.fern.common.spring.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fern.common.auth.InternalServiceAuth;
import com.fern.common.middleware.ServiceException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class RequestAuthenticationFilter extends OncePerRequestFilter {

  private static final Pattern TERMINAL_ORDER_MUTATION_PATTERN = Pattern.compile(
      "^/api/v1/sales/orders/[^/]+/(approve|confirm|mark-payment-done|cancel|customer|ordering-table)$"
  );

  private static final Set<String> PUBLIC_PREFIXES = Set.of(
      "/actuator",
      "/health",
      "/.well-known/jwks.json",
      "/v3/api-docs",
      "/swagger-ui",
      "/swagger-ui.html",
      "/api/v1/auth/login",
      "/api/v1/auth/internal/token",
      "/api/v1/auth/.well-known/jwks.json",
      "/api/v1/sales/public",
      "/api/v1/product/product-images",
      "/api/v1/gateway/info",
      "/api/v1/gateway/routes",
      "/api/v1/gateway/targets",
      "/api/sync/handshake",
      "/api/v1/devices/pair"
  );

  private final JwtTokenService jwtTokenService;
  private final SpringInternalServiceAuth internalServiceAuth;
  private final AuthSessionService authSessionService;
  private final DeviceTokenRegistry deviceTokenRegistry;
  private final ObjectMapper objectMapper;
  private SpringInternalJwtAuth internalJwtAuth;
  private io.micrometer.core.instrument.MeterRegistry meterRegistry;

  public RequestAuthenticationFilter(
      JwtTokenService jwtTokenService,
      SpringInternalServiceAuth internalServiceAuth,
      AuthSessionService authSessionService,
      DeviceTokenRegistry deviceTokenRegistry,
      ObjectMapper objectMapper
  ) {
    this.jwtTokenService = jwtTokenService;
    this.internalServiceAuth = internalServiceAuth;
    this.authSessionService = authSessionService;
    this.deviceTokenRegistry = deviceTokenRegistry;
    this.objectMapper = objectMapper;
  }

  @org.springframework.beans.factory.annotation.Autowired(required = false)
  public void setInternalJwtAuth(SpringInternalJwtAuth internalJwtAuth) {
    this.internalJwtAuth = internalJwtAuth;
  }

  @org.springframework.beans.factory.annotation.Autowired(required = false)
  public void setMeterRegistry(io.micrometer.core.instrument.MeterRegistry meterRegistry) {
    this.meterRegistry = meterRegistry;
  }

  private void recordInternalAuthMethod(String type) {
    if (meterRegistry != null) {
      meterRegistry.counter("internal_auth_method_total", "type", type).increment();
    }
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request,
      HttpServletResponse response,
      FilterChain filterChain
  ) throws ServletException, IOException {
    try {
      RequestUserContext ctx = resolveContext(request);
      RequestUserContextHolder.set(ctx);
      applyOutletScope(ctx, request);
      filterChain.doFilter(request, response);
    } catch (ServiceException exception) {
      writeErrorResponse(response, exception.getStatusCode(), exception.getErrorCode(), exception.getMessage());
    } catch (IllegalArgumentException exception) {
      writeErrorResponse(response, HttpServletResponse.SC_UNAUTHORIZED, "unauthorized", exception.getMessage());
    } finally {
      RequestUserContextHolder.clear();
      OutletScopeContext.clear();
    }
  }

  private static void applyOutletScope(RequestUserContext ctx, HttpServletRequest request) {
    if (ctx.isDeviceContext()) {
      OutletScopeContext.set(ctx.deviceOutletId());
      return;
    }
    // Internal services (sync, OutboxRelay drain, report aggregator) act across outlets.
    if (ctx.internalService()) {
      OutletScopeContext.set(OutletScopeContext.ALL);
      return;
    }
    // Superadmin always operates across all outlets, regardless of JWT outlet claim.
    if (ctx.hasRole("superadmin")) {
      OutletScopeContext.set(OutletScopeContext.ALL);
      return;
    }
    Set<Long> outlets = ctx.outletIds();
    if (outlets == null || outlets.isEmpty()) {
      OutletScopeContext.clear();
      return;
    }
    // Caller may pin which outlet they want via X-Outlet-Id (POS device must always send it).
    String pinned = request.getHeader("X-Outlet-Id");
    if (pinned != null && !pinned.isBlank()) {
      try {
        long outletId = Long.parseLong(pinned.trim());
        if (outlets.contains(outletId)) {
          OutletScopeContext.set(outletId);
          return;
        }
        OutletScopeContext.clear();
        return;
      } catch (NumberFormatException ignored) {
        OutletScopeContext.clear();
        return;
      }
    }
    OutletScopeContext.setAllowedOutletIds(outlets);
  }

  @Override
  protected boolean shouldNotFilter(HttpServletRequest request) {
    String path = request.getRequestURI();
    if (path == null) {
      return false;
    }
    return PUBLIC_PREFIXES.stream().anyMatch(prefix -> matchesPublicPath(path, prefix));
  }

  private static boolean matchesPublicPath(String path, String prefix) {
    return path.equals(prefix) || path.startsWith(prefix + "/");
  }

  private RequestUserContext resolveContext(HttpServletRequest request) {
    HttpHeaders headers = extractHeaders(request);
    // W1.1: prefer per-service internal JWT when header present.
    if (internalJwtAuth != null && internalJwtAuth.hasJwtHeader(headers)) {
      JwtTokenService.InternalTokenClaims jwtClaims = internalJwtAuth.verify(headers);
      recordInternalAuthMethod("jwt");
      String caller = jwtClaims.callerService();
      // When the gateway forwarded a user request it also sends X-Internal-User-Id (and
      // related headers). Trust those headers because the JWT already proved the sender is
      // the gateway (not an untrusted client — STRIP_HEADERS cleared them at the edge).
      String rawUserId = headers.getFirst(InternalServiceAuth.HEADER_USER_ID);
      if ("gateway".equals(caller) && rawUserId != null && !rawUserId.isBlank()) {
        Long userId;
        try {
          userId = Long.parseLong(rawUserId.trim());
        } catch (NumberFormatException ex) {
          throw ServiceException.unauthorized("Invalid X-Internal-User-Id from gateway JWT path");
        }
        String sessionId = headers.getFirst(InternalServiceAuth.HEADER_SESSION_ID);
        Set<String> roles = splitCsv(headers.getFirst(InternalServiceAuth.HEADER_ROLES));
        Set<String> permissions = splitCsv(headers.getFirst(InternalServiceAuth.HEADER_PERMISSIONS));
        Set<Long> outletIds = splitLongCsv(headers.getFirst("X-Internal-Outlet-Ids"));
        authSessionService.requireActiveSession(sessionId, userId);
        return new RequestUserContext(userId, null, sessionId, roles, permissions, outletIds,
            true, false, caller, null, null);
      }
      if ("pos-device".equals(caller)) {
        if (!isDevicePath(request) && !isTerminalOrderMutation(request)) {
          throw ServiceException.forbidden("Device token cannot access this endpoint");
        }
        Long deviceId = parseLongHeader(request, "X-Internal-Device-Id");
        Long deviceOutletId = parseLongHeader(request, "X-Internal-Device-Outlet-Id");
        if (deviceId == null || deviceOutletId == null) {
          throw ServiceException.unauthorized("Missing trusted device context");
        }
        return new RequestUserContext(
            null, null, null, Set.of(), Set.of(), Set.of(),
            true, false, caller, deviceId, deviceOutletId
        );
      }
      return new RequestUserContext(null, caller, null,
          java.util.Set.of(), jwtClaims.scopes(), java.util.Set.of(),
          true, true, caller, null, null);
    }
    SpringInternalServiceAuth.AuthenticatedService internal = internalServiceAuth.authenticate(headers);
    if (internal != null) {
      recordInternalAuthMethod("shared_token");
      if (isDevicePath(request) && !"pos-device".equals(internal.serviceName())) {
        throw ServiceException.forbidden("Sync endpoints require device JWT authentication");
      }
      if ("pos-device".equals(internal.serviceName())) {
        if (!isDevicePath(request) && !isTerminalOrderMutation(request)) {
          throw ServiceException.forbidden("Device token cannot access this endpoint");
        }
        Long deviceId = parseLongHeader(request, "X-Internal-Device-Id");
        Long deviceOutletId = parseLongHeader(request, "X-Internal-Device-Outlet-Id");
        if (deviceId == null || deviceOutletId == null) {
          throw ServiceException.unauthorized("Missing trusted device context");
        }
        return new RequestUserContext(
            null, null, null, Set.of(), Set.of(), Set.of(),
            true, false, internal.serviceName(), deviceId, deviceOutletId
        );
      }
      boolean gatewayForwardedUser = "gateway".equals(internal.serviceName()) && internal.userId() != null;
      if (gatewayForwardedUser) {
        authSessionService.requireActiveSession(internal.sessionId(), internal.userId());
      }
      return new RequestUserContext(
          internal.userId(),
          null,
          internal.sessionId(),
          internal.roles(),
          internal.permissions(),
          internal.outletIds(),
          internal.userId() != null,
          !gatewayForwardedUser,
          internal.serviceName(),
          null,
          null
      );
    }

    String authorization = request.getHeader(HttpHeaders.AUTHORIZATION);
    if (authorization == null || authorization.isBlank()) {
      throw ServiceException.unauthorized("Missing authentication credentials");
    }
    if (!authorization.startsWith("Bearer ")) {
      throw ServiceException.unauthorized("Unsupported authorization type");
    }
    String token = authorization.substring("Bearer ".length()).trim();
    JwtClaims claims = jwtTokenService.verify(token);
    if (claims.isDeviceToken()) {
      if (!isDevicePath(request) && !isTerminalOrderMutation(request)) {
        throw ServiceException.forbidden("Device token cannot access this endpoint");
      }
      deviceTokenRegistry.requireActiveDevice(claims, token);
      return new RequestUserContext(
          null, null, null, Set.of(), Set.of(), Set.of(),
          true, false, null, claims.deviceId(), claims.deviceOutletId()
      );
    }
    if (isDevicePath(request)) {
      throw ServiceException.forbidden("Sync endpoints require device JWT authentication");
    }
    authSessionService.requireActiveSession(claims.sessionId(), claims.userId());
    return new RequestUserContext(
        claims.userId(),
        claims.username(),
        claims.sessionId(),
        claims.roles(),
        claims.permissions(),
        claims.outletIds(),
        true,
        false,
        null,
        null,
        null
    );
  }

  private static HttpHeaders extractHeaders(HttpServletRequest request) {
    HttpHeaders headers = new HttpHeaders();
    for (String name : Set.of(
        InternalServiceAuth.HEADER_SERVICE_NAME,
        InternalServiceAuth.HEADER_SERVICE_TOKEN,
        InternalServiceAuth.HEADER_USER_ID,
        InternalServiceAuth.HEADER_SESSION_ID,
        InternalServiceAuth.HEADER_ROLES,
        InternalServiceAuth.HEADER_PERMISSIONS,
        "X-Internal-Outlet-Ids",
        SpringInternalJwtAuth.HEADER_INTERNAL_JWT  // W1.1: per-service internal JWT
    )) {
      String value = request.getHeader(name);
      if (value != null) {
        headers.add(name, value);
      }
    }
    return headers;
  }

  private void writeErrorResponse(HttpServletResponse response, int status, String errorCode, String message) {
    try {
      response.setStatus(status);
      response.setContentType("application/json");
      response.setCharacterEncoding("UTF-8");
      String body = objectMapper.writeValueAsString(Map.of("error", errorCode, "message", message));
      response.getWriter().write(body);
    } catch (IOException ioe) {
      response.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
    }
  }

  private static boolean isDevicePath(HttpServletRequest request) {
    String path = request.getRequestURI();
    return path != null
        && (path.startsWith("/api/v1/sync/")
            || (path.startsWith("/api/sync/") && !path.startsWith("/api/sync/internal/"))
            || path.startsWith("/api/v1/devices/refresh")
            || path.startsWith("/api/v1/telemetry"));
  }

  private static boolean isTerminalOrderWrite(HttpServletRequest request, String path) {
    return "POST".equalsIgnoreCase(request.getMethod())
        && "/api/v1/sales/orders".equals(path);
  }

  private static boolean isTerminalOrderMutation(HttpServletRequest request) {
    if (!"POST".equalsIgnoreCase(request.getMethod())) {
      return false;
    }
    String path = request.getRequestURI();
    if (path == null) {
      return false;
    }
    return isTerminalOrderWrite(request, path) || TERMINAL_ORDER_MUTATION_PATTERN.matcher(path).matches();
  }

  private static Long parseLongHeader(HttpServletRequest request, String name) {
    String value = request.getHeader(name);
    if (value == null || value.isBlank()) {
      return null;
    }
    try {
      return Long.parseLong(value.trim());
    } catch (NumberFormatException ex) {
      throw ServiceException.unauthorized("Invalid " + name);
    }
  }

  private static Set<String> splitCsv(String raw) {
    if (raw == null || raw.isBlank()) {
      return Set.of();
    }
    Set<String> result = new java.util.LinkedHashSet<>();
    for (String part : raw.split(",")) {
      String trimmed = part.trim();
      if (!trimmed.isEmpty()) {
        result.add(trimmed);
      }
    }
    return java.util.Collections.unmodifiableSet(result);
  }

  private static Set<Long> splitLongCsv(String raw) {
    if (raw == null || raw.isBlank()) {
      return Set.of();
    }
    Set<Long> result = new java.util.LinkedHashSet<>();
    for (String part : raw.split(",")) {
      String trimmed = part.trim();
      if (!trimmed.isEmpty()) {
        try {
          result.add(Long.parseLong(trimmed));
        } catch (NumberFormatException ignored) {
          // skip malformed entries
        }
      }
    }
    return java.util.Collections.unmodifiableSet(result);
  }
}
