package com.fern.gateway.config;

import java.util.List;
import java.util.Arrays;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.util.StringUtils;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.reactive.CorsWebFilter;
import org.springframework.web.cors.reactive.UrlBasedCorsConfigurationSource;

@Configuration
public class GatewayCorsConfiguration {

  @Bean
  public CorsWebFilter corsWebFilter(
      @Value("${fern.gateway.cors.allowed-origins:}") List<String> allowedOrigins,
      @Value("${fern.gateway.cors.allowed-methods:GET,POST,PUT,PATCH,DELETE,OPTIONS}") List<String> allowedMethods,
      @Value("${fern.gateway.cors.allowed-headers:Authorization,Content-Type,X-Correlation-ID}") List<String> allowedHeaders,
      @Value("${fern.gateway.cors.exposed-headers:X-Correlation-ID,X-Gateway-Upstream-Service}") List<String> exposedHeaders
  ) {
    CorsConfiguration config = new CorsConfiguration();
    List<String> normalizedOrigins = normalize(allowedOrigins);
    if (normalizedOrigins.isEmpty()) {
      // Keep local frontend development working when no explicit CORS env is provided.
      config.setAllowedOriginPatterns(List.of("http://127.0.0.1:[*]", "http://localhost:[*]"));
    } else {
      config.setAllowedOrigins(normalizedOrigins);
    }
    config.setAllowedMethods(normalize(allowedMethods));
    config.setAllowedHeaders(normalize(allowedHeaders));
    config.setExposedHeaders(normalize(exposedHeaders));
    config.setAllowCredentials(true);
    config.setMaxAge(3600L);

    UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
    source.registerCorsConfiguration("/**", config);
    return new CorsWebFilter(source);
  }

  private static List<String> normalize(List<String> values) {
    return values.stream()
        .filter(StringUtils::hasText)
        .flatMap(value -> Arrays.stream(value.split(",")))
        .map(String::trim)
        .filter(StringUtils::hasText)
        .distinct()
        .collect(Collectors.toList());
  }
}
