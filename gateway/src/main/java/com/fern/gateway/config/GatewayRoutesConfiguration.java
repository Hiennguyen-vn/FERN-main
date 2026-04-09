package com.fern.gateway.config;

import com.fern.gateway.routing.GatewayRoute;
import com.fern.gateway.routing.GatewayRouteCatalog;
import org.springframework.cloud.gateway.route.RouteLocator;
import org.springframework.cloud.gateway.route.builder.RouteLocatorBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class GatewayRoutesConfiguration {

  @Bean
  public RouteLocator routeLocator(RouteLocatorBuilder builder) {
    RouteLocatorBuilder.Builder routes = builder.routes();
    for (GatewayRoute route : GatewayRouteCatalog.routes()) {
      if ("gateway".equals(route.serviceName())) {
        continue;
      }
      routes.route(route.serviceName() + "-" + route.pathPrefix(), spec -> spec
          .path(route.pathPrefix() + "/**")
          .filters(filters -> filters.addResponseHeader("X-Gateway-Upstream-Service", route.serviceName()))
          .uri(route.baseUrl()));
    }
    return routes.build();
  }
}
