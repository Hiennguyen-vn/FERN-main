package com.fern.gateway.security;

import com.fern.common.auth.AuthTokenExtractor;
import com.fern.common.auth.InternalServiceAuth;
import com.fern.common.spring.auth.AuthSessionService;
import com.fern.common.spring.auth.DeviceTokenRegistry;
import com.fern.common.spring.auth.JwtClaims;
import com.fern.common.spring.auth.JwtTokenService;
import com.fern.common.spring.auth.SpringInternalServiceAuth;
import com.fern.common.spring.web.CorrelationIdFilter;
import java.util.Set;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.cors.reactive.CorsUtils;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

@Component
public class GatewayAuthenticationFilter implements GlobalFilter, Ordered {

  private static final Set<String> STRIP_HEADERS = Set.of(
      InternalServiceAuth.HEADER_SERVICE_NAME,
      InternalServiceAuth.HEADER_SERVICE_TOKEN,
      InternalServiceAuth.HEADER_USER_ID,
      InternalServiceAuth.HEADER_SESSION_ID,
      InternalServiceAuth.HEADER_ROLES,
      InternalServiceAuth.HEADER_PERMISSIONS,
      "X-Internal-Outlet-Ids",
      "X-Internal-Device-Id",
      "X-Internal-Device-Outlet-Id"
  );

  private final JwtTokenService jwtTokenService;
  private final SpringInternalServiceAuth internalServiceAuth;
  private final AuthSessionService authSessionService;
  private final DeviceTokenRegistry deviceTokenRegistry;
  private final String authCookieName;

  public GatewayAuthenticationFilter(
      JwtTokenService jwtTokenService,
      SpringInternalServiceAuth internalServiceAuth,
      AuthSessionService authSessionService,
      DeviceTokenRegistry deviceTokenRegistry,
      @org.springframework.beans.factory.annotation.Value("${AUTH_COOKIE_NAME:dorabets_session}") String authCookieName
  ) {
    this.jwtTokenService = jwtTokenService;
    this.internalServiceAuth = internalServiceAuth;
    this.authSessionService = authSessionService;
    this.deviceTokenRegistry = deviceTokenRegistry;
    this.authCookieName = authCookieName;
  }

  @Override
  public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
    String path = exchange.getRequest().getURI().getPath();
    String correlationId = exchange.getRequest().getHeaders().getFirst(CorrelationIdFilter.HEADER);
    if (correlationId == null || correlationId.isBlank()) {
      correlationId = java.util.UUID.randomUUID().toString();
    }
    final String resolvedCorrelationId = correlationId;

    ServerHttpRequest.Builder builder = exchange.getRequest().mutate();
    builder.headers(httpHeaders -> {
      STRIP_HEADERS.forEach(httpHeaders::remove);
      httpHeaders.set(CorrelationIdFilter.HEADER, resolvedCorrelationId);
      httpHeaders.set("X-Forwarded-By", "gateway");
    });

    if (isPublicPath(path) || isCorsPreflight(exchange)) {
      return chain.filter(exchange.mutate().request(builder.build()).build());
    }

    HttpHeaders requestHeaders = exchange.getRequest().getHeaders();
    String authorization = requestHeaders.getFirst(HttpHeaders.AUTHORIZATION);
    if (authorization != null && !authorization.startsWith("Bearer ")) {
      exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
      return exchange.getResponse().setComplete();
    }

    String token = AuthTokenExtractor.extractToken(
        authorization,
        requestHeaders.getFirst(HttpHeaders.COOKIE),
        authCookieName
    );
    if (token != null) {
      try {
        JwtClaims claims = jwtTokenService.verify(token);
        if (claims.isDeviceToken()) {
          if (!isDevicePath(path)) {
            exchange.getResponse().setStatusCode(HttpStatus.FORBIDDEN);
            return exchange.getResponse().setComplete();
          }
          deviceTokenRegistry.requireActiveDevice(claims, token);
          builder.headers(h -> {
            internalServiceAuth.apply(h, "pos-device", null);
            h.set("X-Internal-Device-Id", Long.toString(claims.deviceId()));
            h.set("X-Internal-Device-Outlet-Id", Long.toString(claims.deviceOutletId()));
          });
          return chain.filter(exchange.mutate().request(builder.build()).build());
        }
        if (isDevicePath(path)) {
          exchange.getResponse().setStatusCode(HttpStatus.FORBIDDEN);
          return exchange.getResponse().setComplete();
        }
        authSessionService.requireActiveSession(claims.sessionId(), claims.userId());
        HttpHeaders internalHeaders = new HttpHeaders();
        internalServiceAuth.apply(internalHeaders, "gateway", claims);
        builder.headers(httpHeaders -> internalHeaders.forEach((name, values) -> {
          if (values != null && !values.isEmpty()) {
            httpHeaders.set(name, values.getFirst());
          }
        }));
        return chain.filter(exchange.mutate().request(builder.build()).build());
      } catch (Exception e) {
        exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
        return exchange.getResponse().setComplete();
      }
    }

    if (internalServiceAuth.hasInternalHeaders(requestHeaders)) {
      try {
        SpringInternalServiceAuth.AuthenticatedService internal = internalServiceAuth.authenticate(requestHeaders);
        if (isDevicePath(path)) {
          exchange.getResponse().setStatusCode(HttpStatus.FORBIDDEN);
          return exchange.getResponse().setComplete();
        }
        if ("pos-edge-agent".equals(internal.serviceName())) {
          exchange.getResponse().setStatusCode(HttpStatus.FORBIDDEN);
          return exchange.getResponse().setComplete();
        }
        builder.headers(httpHeaders -> applyTrustedInternalHeaders(httpHeaders, internal, requestHeaders));
        return chain.filter(exchange.mutate().request(builder.build()).build());
      } catch (Exception e) {
        exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
        return exchange.getResponse().setComplete();
      }
    }

    exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
    return exchange.getResponse().setComplete();
  }

  @Override
  public int getOrder() {
    return -100;
  }

  private boolean isDevicePath(String path) {
    return path.startsWith("/api/v1/sync/")
        || path.startsWith("/api/v1/devices/refresh");
  }

  private boolean isPublicPath(String path) {
    return path.startsWith("/actuator")
        || path.startsWith("/health")
        || path.equals("/api/v1/gateway/info")
        || path.equals("/api/v1/gateway/routes")
        || path.equals("/api/v1/gateway/targets")
        || path.startsWith("/internal/gateway/fallback")
        || path.startsWith("/api/v1/auth/login")
        || path.startsWith("/api/v1/sales/public")
        || path.startsWith("/api/v1/product/product-images")
        || path.equals("/api/v1/devices/pair");
  }

  private boolean isCorsPreflight(ServerWebExchange exchange) {
    return HttpMethod.OPTIONS.equals(exchange.getRequest().getMethod())
        && CorsUtils.isPreFlightRequest(exchange.getRequest());
  }

  private void applyTrustedInternalHeaders(
      HttpHeaders targetHeaders,
      SpringInternalServiceAuth.AuthenticatedService internal,
      HttpHeaders requestHeaders
  ) {
    targetHeaders.set(InternalServiceAuth.HEADER_SERVICE_NAME, internal.serviceName());
    String token = requestHeaders.getFirst(InternalServiceAuth.HEADER_SERVICE_TOKEN);
    if (token != null && !token.isBlank()) {
      targetHeaders.set(InternalServiceAuth.HEADER_SERVICE_TOKEN, token.trim());
    }
    if (internal.userId() != null) {
      targetHeaders.set(InternalServiceAuth.HEADER_USER_ID, Long.toString(internal.userId()));
    }
    if (internal.sessionId() != null && !internal.sessionId().isBlank()) {
      targetHeaders.set(InternalServiceAuth.HEADER_SESSION_ID, internal.sessionId());
    }
    if (!internal.roles().isEmpty()) {
      targetHeaders.set(InternalServiceAuth.HEADER_ROLES, String.join(",", internal.roles()));
    }
    if (!internal.permissions().isEmpty()) {
      targetHeaders.set(InternalServiceAuth.HEADER_PERMISSIONS, String.join(",", internal.permissions()));
    }
    if (!internal.outletIds().isEmpty()) {
      targetHeaders.set(
          "X-Internal-Outlet-Ids",
          internal.outletIds().stream().map(String::valueOf).reduce((a, b) -> a + "," + b).orElse("")
      );
    }
  }
}
