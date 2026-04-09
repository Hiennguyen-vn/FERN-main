package com.dorabets.common.spring.auth;

import com.dorabets.common.auth.InternalServiceAuth;
import com.dorabets.common.middleware.ServiceException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Set;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class RequestAuthenticationFilter extends OncePerRequestFilter {

  private static final Set<String> PUBLIC_PREFIXES = Set.of(
      "/actuator",
      "/health",
      "/api/v1/auth/login",
      "/api/v1/sales/public",
      "/api/v1/gateway/info",
      "/api/v1/gateway/routes",
      "/api/v1/gateway/targets"
  );

  private final JwtTokenService jwtTokenService;
  private final SpringInternalServiceAuth internalServiceAuth;
  private final AuthSessionService authSessionService;

  public RequestAuthenticationFilter(
      JwtTokenService jwtTokenService,
      SpringInternalServiceAuth internalServiceAuth,
      AuthSessionService authSessionService
  ) {
    this.jwtTokenService = jwtTokenService;
    this.internalServiceAuth = internalServiceAuth;
    this.authSessionService = authSessionService;
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request,
      HttpServletResponse response,
      FilterChain filterChain
  ) throws ServletException, IOException {
    try {
      RequestUserContextHolder.set(resolveContext(request));
      filterChain.doFilter(request, response);
    } catch (ServiceException exception) {
      response.setStatus(exception.getStatusCode());
      response.setContentType("application/json");
      response.getWriter().write("{\"error\":\"" + exception.getErrorCode() + "\",\"message\":\"" + exception.getMessage() + "\"}");
    } catch (IllegalArgumentException exception) {
      response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
      response.setContentType("application/json");
      response.getWriter().write("{\"error\":\"unauthorized\",\"message\":\"" + exception.getMessage() + "\"}");
    } finally {
      RequestUserContextHolder.clear();
    }
  }

  @Override
  protected boolean shouldNotFilter(HttpServletRequest request) {
    String path = request.getRequestURI();
    if (path == null) {
      return false;
    }
    return PUBLIC_PREFIXES.stream().anyMatch(path::startsWith);
  }

  private RequestUserContext resolveContext(HttpServletRequest request) {
    HttpHeaders headers = extractHeaders(request);
    SpringInternalServiceAuth.AuthenticatedService internal = internalServiceAuth.authenticate(headers);
    if (internal != null) {
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
          internal.serviceName()
      );
    }

    String authorization = request.getHeader(HttpHeaders.AUTHORIZATION);
    if (authorization == null || authorization.isBlank()) {
      throw ServiceException.unauthorized("Missing authentication credentials");
    }
    if (!authorization.startsWith("Bearer ")) {
      throw ServiceException.unauthorized("Unsupported authorization type");
    }
    JwtClaims claims = jwtTokenService.verify(authorization.substring("Bearer ".length()).trim());
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
        "X-Internal-Outlet-Ids"
    )) {
      String value = request.getHeader(name);
      if (value != null) {
        headers.add(name, value);
      }
    }
    return headers;
  }
}
