package com.fern.gateway.config;

import com.fern.common.auth.InternalServiceAuth;
import com.fern.gateway.routing.GatewayRoute;
import com.fern.gateway.routing.GatewayRouteCatalog;
import java.net.InetSocketAddress;
import java.util.Locale;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.cloud.gateway.filter.ratelimit.KeyResolver;
import org.springframework.cloud.gateway.filter.ratelimit.RedisRateLimiter;
import org.springframework.cloud.gateway.route.RouteLocator;
import org.springframework.cloud.gateway.route.builder.RouteLocatorBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import reactor.core.publisher.Mono;

@Configuration
public class GatewayRoutesConfiguration {

  @Bean
  @Primary
  public RedisRateLimiter defaultRateLimiter() {
    return new RedisRateLimiter(60, 120, 1);
  }

  @Bean
  @Qualifier("authRateLimiter")
  public RedisRateLimiter authRateLimiter() {
    return new RedisRateLimiter(10, 20, 1);
  }

  @Bean
  @Qualifier("syncRateLimiter")
  public RedisRateLimiter syncRateLimiter() {
    return new RedisRateLimiter(30, 60, 1);
  }

  @Bean
  @Qualifier("reportRateLimiter")
  public RedisRateLimiter reportRateLimiter() {
    return new RedisRateLimiter(20, 40, 1);
  }

  @Bean
  public KeyResolver gatewayRateLimitKeyResolver() {
    return exchange -> Mono.just(resolveRateLimitKey(
        exchange.getRequest().getHeaders(),
        exchange.getRequest().getRemoteAddress()
    ));
  }

  @Bean
  public RouteLocator routeLocator(
      RouteLocatorBuilder builder,
      KeyResolver gatewayRateLimitKeyResolver,
      @Qualifier("defaultRateLimiter") RedisRateLimiter defaultRateLimiter,
      @Qualifier("authRateLimiter") RedisRateLimiter authRateLimiter,
      @Qualifier("syncRateLimiter") RedisRateLimiter syncRateLimiter,
      @Qualifier("reportRateLimiter") RedisRateLimiter reportRateLimiter
  ) {
    RouteLocatorBuilder.Builder routes = builder.routes();
    for (GatewayRoute route : GatewayRouteCatalog.routes()) {
      if ("gateway".equals(route.serviceName())) {
        continue;
      }
      String routeId = routeId(route);
      GatewayRoutePolicy policy = routePolicy(
          route,
          defaultRateLimiter,
          authRateLimiter,
          syncRateLimiter,
          reportRateLimiter
      );
      routes.route(routeId, spec -> spec
          .path(route.pathPrefix(), route.pathPrefix() + "/**")
          .filters(filters -> {
            filters.addResponseHeader("X-Gateway-Upstream-Service", route.serviceName());
            filters.addResponseHeader("X-Gateway-Route-Id", routeId);
            filters.requestRateLimiter(config -> {
              config.setRouteId(routeId);
              config.setKeyResolver(gatewayRateLimitKeyResolver);
              config.setRateLimiter(policy.rateLimiter());
              config.setStatusCode(HttpStatus.TOO_MANY_REQUESTS);
              config.setDenyEmptyKey(Boolean.TRUE);
            });
            filters.circuitBreaker(config -> {
              config.setRouteId(routeId);
              config.setName(circuitBreakerName(route));
              config.setFallbackUri("forward:/internal/gateway/fallback/" + route.serviceName());
              config.addStatusCode("BAD_GATEWAY");
              config.addStatusCode("SERVICE_UNAVAILABLE");
              config.addStatusCode("GATEWAY_TIMEOUT");
            });
            return filters;
          })
          .uri(route.baseUrl()));
    }
    return routes.build();
  }

  private static GatewayRoutePolicy routePolicy(
      GatewayRoute route,
      RedisRateLimiter defaultRateLimiter,
      RedisRateLimiter authRateLimiter,
      RedisRateLimiter syncRateLimiter,
      RedisRateLimiter reportRateLimiter
  ) {
    if (route.pathPrefix().startsWith("/api/v1/auth")) {
      return new GatewayRoutePolicy(authRateLimiter);
    }
    if (route.pathPrefix().startsWith("/api/v1/sync")) {
      return new GatewayRoutePolicy(syncRateLimiter);
    }
    if (route.pathPrefix().startsWith("/api/v1/report")) {
      return new GatewayRoutePolicy(reportRateLimiter);
    }
    return new GatewayRoutePolicy(defaultRateLimiter);
  }

  static String circuitBreakerName(GatewayRoute route) {
    return routeId(route);
  }

  private static String routeId(GatewayRoute route) {
    return (route.serviceName() + route.pathPrefix())
        .replace('/', '-')
        .replaceAll("-+", "-")
        .replaceAll("^-|-$", "")
        .toLowerCase(Locale.ROOT);
  }

  private static String resolveRateLimitKey(HttpHeaders headers, InetSocketAddress remoteAddress) {
    String internalService = trim(headers.getFirst(InternalServiceAuth.HEADER_SERVICE_NAME));
    if (internalService != null) {
      String outletScope = trim(headers.getFirst("X-Internal-Outlet-Ids"));
      return "svc:" + internalService + ":" + (outletScope == null ? "all" : outletScope);
    }
    String internalUserId = trim(headers.getFirst(InternalServiceAuth.HEADER_USER_ID));
    if (internalUserId != null) {
      return "user:" + internalUserId;
    }
    String forwardedFor = trim(headers.getFirst("X-Forwarded-For"));
    if (forwardedFor != null) {
      return "ip:" + forwardedFor.split(",")[0].trim();
    }
    if (remoteAddress != null && remoteAddress.getAddress() != null) {
      return "ip:" + remoteAddress.getAddress().getHostAddress();
    }
    return "ip:unknown";
  }

  private static String trim(String value) {
    if (value == null) {
      return null;
    }
    String trimmed = value.trim();
    return trimmed.isEmpty() ? null : trimmed;
  }

  private record GatewayRoutePolicy(RedisRateLimiter rateLimiter) {
  }
}
