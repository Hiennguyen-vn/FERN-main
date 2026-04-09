package com.dorabets.common.spring.auth;

import com.dorabets.common.auth.InternalServiceAuth;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.LinkedHashSet;
import java.util.Set;
import org.springframework.http.HttpHeaders;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

public class SpringInternalServiceAuth {

  private final String sharedToken;
  private final Set<String> allowlist;

  public SpringInternalServiceAuth() {
    this(requireSharedToken(), parseCsv(System.getenv("INTERNAL_SERVICE_ALLOWLIST")));
  }

  public SpringInternalServiceAuth(String sharedToken) {
    this(sharedToken, Set.of());
  }

  public SpringInternalServiceAuth(String sharedToken, Set<String> allowlist) {
    this.sharedToken = normalizeRequiredToken(sharedToken);
    this.allowlist = allowlist == null ? Set.of() : Set.copyOf(new LinkedHashSet<>(allowlist));
  }

  public boolean isConfigured() {
    return sharedToken != null && !sharedToken.isBlank();
  }

  public boolean hasInternalHeaders(HttpHeaders headers) {
    return header(headers, InternalServiceAuth.HEADER_SERVICE_NAME) != null
        || header(headers, InternalServiceAuth.HEADER_SERVICE_TOKEN) != null;
  }

  public AuthenticatedService authenticate(HttpHeaders headers) {
    String serviceName = header(headers, InternalServiceAuth.HEADER_SERVICE_NAME);
    String token = header(headers, InternalServiceAuth.HEADER_SERVICE_TOKEN);
    if (serviceName == null && token == null) {
      return null;
    }
    if (serviceName == null || token == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid internal service authentication");
    }
    if (!isConfigured()) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Internal service authentication is not configured");
    }
    if (!allowlist.isEmpty() && !allowlist.contains(serviceName)) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Service is not allowed: " + serviceName);
    }
    if (!MessageDigest.isEqual(sharedToken.getBytes(StandardCharsets.UTF_8), token.getBytes(StandardCharsets.UTF_8))) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid internal service authentication");
    }
    return new AuthenticatedService(
        serviceName,
        parseLong(header(headers, InternalServiceAuth.HEADER_USER_ID)),
        header(headers, InternalServiceAuth.HEADER_SESSION_ID),
        parseCsv(header(headers, InternalServiceAuth.HEADER_ROLES)),
        parseCsv(header(headers, InternalServiceAuth.HEADER_PERMISSIONS)),
        parseLongCsv(header(headers, "X-Internal-Outlet-Ids"))
    );
  }

  public void apply(HttpHeaders headers, String serviceName, JwtClaims claims) {
    if (!isConfigured()) {
      throw new IllegalStateException("INTERNAL_SERVICE_TOKEN is required for internal service requests");
    }
    headers.set(InternalServiceAuth.HEADER_SERVICE_NAME, serviceName);
    headers.set(InternalServiceAuth.HEADER_SERVICE_TOKEN, sharedToken);
    if (claims != null) {
      if (claims.userId() != null) {
        headers.set(InternalServiceAuth.HEADER_USER_ID, Long.toString(claims.userId()));
      }
      if (claims.sessionId() != null && !claims.sessionId().isBlank()) {
        headers.set(InternalServiceAuth.HEADER_SESSION_ID, claims.sessionId());
      }
      if (!claims.roles().isEmpty()) {
        headers.set(InternalServiceAuth.HEADER_ROLES, String.join(",", claims.roles()));
      }
      if (!claims.permissions().isEmpty()) {
        headers.set(InternalServiceAuth.HEADER_PERMISSIONS, String.join(",", claims.permissions()));
      }
      if (!claims.outletIds().isEmpty()) {
        headers.set("X-Internal-Outlet-Ids", claims.outletIds().stream().map(String::valueOf).reduce((a, b) -> a + "," + b).orElse(""));
      }
    }
  }

  private static String requireSharedToken() {
    String configured = System.getenv("INTERNAL_SERVICE_TOKEN");
    return normalizeRequiredToken(configured);
  }

  private static String normalizeRequiredToken(String configured) {
    if (configured == null || configured.isBlank()) {
      throw new IllegalStateException("INTERNAL_SERVICE_TOKEN must be configured");
    }
    return configured.trim();
  }

  private static Set<String> parseCsv(String raw) {
    Set<String> values = new LinkedHashSet<>();
    if (raw == null || raw.isBlank()) {
      return Set.of();
    }
    for (String token : raw.split(",")) {
      String value = token.trim();
      if (!value.isBlank()) {
        values.add(value);
      }
    }
    return Set.copyOf(values);
  }

  private static Set<Long> parseLongCsv(String raw) {
    Set<Long> values = new LinkedHashSet<>();
    if (raw == null || raw.isBlank()) {
      return Set.of();
    }
    for (String token : raw.split(",")) {
      String value = token.trim();
      if (!value.isBlank()) {
        values.add(Long.parseLong(value));
      }
    }
    return Set.copyOf(values);
  }

  private static Long parseLong(String raw) {
    if (raw == null || raw.isBlank()) {
      return null;
    }
    return Long.parseLong(raw);
  }

  private static String header(HttpHeaders headers, String name) {
    String value = headers.getFirst(name);
    if (value == null) {
      return null;
    }
    String trimmed = value.trim();
    return trimmed.isEmpty() ? null : trimmed;
  }

  public record AuthenticatedService(
      String serviceName,
      Long userId,
      String sessionId,
      Set<String> roles,
      Set<String> permissions,
      Set<Long> outletIds
  ) {
  }
}
