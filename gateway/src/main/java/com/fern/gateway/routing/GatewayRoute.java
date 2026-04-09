package com.fern.gateway.routing;

public record GatewayRoute(
    String pathPrefix,
    String serviceName,
    String baseUrl
) {
}
