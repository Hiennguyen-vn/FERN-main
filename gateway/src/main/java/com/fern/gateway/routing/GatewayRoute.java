package com.fern.gateway.routing;

public record GatewayRoute(
    String pathPrefix,
    String serviceName,
    String baseUrl,
    RouteClass routeClass,
    RateLimitTier rateLimitTier
) {

  /** Backward-compatible 3-arg ctor — defaults to USER routeClass + DEFAULT tier. */
  public GatewayRoute(String pathPrefix, String serviceName, String baseUrl) {
    this(pathPrefix, serviceName, baseUrl, RouteClass.USER, RateLimitTier.DEFAULT);
  }

  public enum RouteClass {
    /** No auth required (login, jwks, swagger, health). */
    PUBLIC,
    /** User session JWT required. */
    USER,
    /** Device JWT required (POS edge). */
    DEVICE,
    /** Internal service JWT required; rejects browser/user tokens. */
    INTERNAL_ONLY
  }

  public enum RateLimitTier {
    DEFAULT,
    AUTH,
    SYNC,
    REPORT,
    TELEMETRY,
    AI_QUERY
  }
}
