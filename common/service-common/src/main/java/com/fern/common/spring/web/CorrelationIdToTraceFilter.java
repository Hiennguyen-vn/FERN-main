package com.fern.common.spring.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import org.slf4j.MDC;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Bridges the legacy {@code X-Correlation-Id} header (used by audit/trace logs throughout the codebase)
 * with OpenTelemetry-style trace context.
 *
 * <p>For each inbound HTTP request:
 * <ul>
 *   <li>Reads incoming {@code X-Correlation-Id} or generates one if missing.</li>
 *   <li>Stores it in MDC under {@code correlationId} so logback patterns continue to work.</li>
 *   <li>Mirrors the value back on the response so the caller can stitch traces.</li>
 * </ul>
 *
 * <p>Spring Boot's auto-configured tracing layer separately populates {@code traceId}/{@code spanId}
 * in MDC when {@code micrometer-tracing-bridge-otel} is on the classpath. This filter does not
 * interfere with that — both fields end up in the log line.
 *
 * <p>Ordered before the auth filter so the ID is in MDC for any auth-related logs.
 */
@Component
@ConditionalOnClass(name = "io.micrometer.tracing.Tracer")
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class CorrelationIdToTraceFilter extends OncePerRequestFilter {

  public static final String HEADER = "X-Correlation-Id";
  public static final String MDC_KEY = "correlationId";

  @Override
  protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    String correlationId = request.getHeader(HEADER);
    if (correlationId == null || correlationId.isBlank()) {
      correlationId = UUID.randomUUID().toString();
    }
    MDC.put(MDC_KEY, correlationId);
    response.setHeader(HEADER, correlationId);
    try {
      chain.doFilter(request, response);
    } finally {
      MDC.remove(MDC_KEY);
    }
  }
}
