package com.fern.services.auth.spring.api;

import com.fern.common.spring.auth.JwtTokenService;
import jakarta.validation.constraints.NotBlank;
import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Mints per-service internal JWT tokens. Caller authenticates with a bootstrap secret
 * configured via env INTERNAL_BOOTSTRAP_SECRETS_<CALLER_UPPER>. Public endpoint behind
 * gateway internal-only path; rate-limited at gateway.
 */
@RestController
@RequestMapping("/api/v1/auth/internal")
public class InternalTokenController {

  private final JwtTokenService jwtTokenService;
  private final long defaultTtlSeconds;

  public InternalTokenController(
      JwtTokenService jwtTokenService,
      @Value("${internal.token.ttl-seconds:600}") long defaultTtlSeconds
  ) {
    this.jwtTokenService = jwtTokenService;
    this.defaultTtlSeconds = defaultTtlSeconds;
  }

  public record IssueRequest(
      @NotBlank String callerService,
      @NotBlank String callerSecret,
      @NotBlank String targetService,
      List<String> scopes,
      Long ttlSeconds
  ) {}

  @PostMapping("/token")
  public ResponseEntity<Map<String, Object>> issue(@RequestBody IssueRequest req) {
    if (req == null || req.callerService() == null || req.callerSecret() == null) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "callerService + callerSecret required");
    }
    String envKey = "INTERNAL_BOOTSTRAP_SECRET_" + req.callerService().toUpperCase().replace('-', '_');
    String expected = System.getenv(envKey);
    if (expected == null || expected.isBlank()) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Caller not provisioned");
    }
    if (!MessageDigest.isEqual(expected.getBytes(), req.callerSecret().getBytes())) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid caller secret");
    }
    long ttl = req.ttlSeconds() != null && req.ttlSeconds() > 0
        ? Math.min(req.ttlSeconds(), 3600)
        : defaultTtlSeconds;
    Set<String> scopes = req.scopes() == null ? Set.of() : Set.copyOf(req.scopes());
    String token = jwtTokenService.issueInternalToken(req.callerService(), req.targetService(), scopes, ttl);
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("access_token", token);
    body.put("token_type", "Bearer");
    body.put("expires_in", ttl);
    body.put("aud", req.targetService());
    body.put("scope", String.join(" ", scopes));
    return ResponseEntity.ok(body);
  }
}
