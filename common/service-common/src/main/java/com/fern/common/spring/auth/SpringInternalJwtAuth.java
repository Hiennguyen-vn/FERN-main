package com.fern.common.spring.auth;

import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Verifies per-service JWT internal tokens. Header: X-Internal-Auth-Token: <jwt>.
 * Token must have aud=<this service>, token_use=internal, valid signature.
 *
 * Coexists with SpringInternalServiceAuth (shared token). Rollout flag
 * `internal.auth.allow-shared-token` (default true) keeps shared-token path live until cutover.
 */
@Component
public class SpringInternalJwtAuth {

  public static final String HEADER_INTERNAL_JWT = "X-Internal-Auth-Token";

  private final JwtTokenService jwtTokenService;
  private final String selfServiceName;

  public SpringInternalJwtAuth(
      JwtTokenService jwtTokenService,
      @Value("${spring.application.name:fern-service}") String selfServiceName
  ) {
    this.jwtTokenService = jwtTokenService;
    this.selfServiceName = selfServiceName;
  }

  public boolean hasJwtHeader(HttpHeaders headers) {
    String v = headers.getFirst(HEADER_INTERNAL_JWT);
    return v != null && !v.isBlank();
  }

  /** Verifies JWT in headers; throws 401/403 on failure. Returns claims on success. */
  public JwtTokenService.InternalTokenClaims verify(HttpHeaders headers) {
    String token = headers.getFirst(HEADER_INTERNAL_JWT);
    if (token == null || token.isBlank()) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Missing internal JWT");
    }
    try {
      return jwtTokenService.verifyInternalToken(token.trim(), selfServiceName);
    } catch (IllegalArgumentException e) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid internal JWT: " + e.getMessage());
    }
  }

  /** Verifies + checks required scope. Throws 403 if scope absent. */
  public JwtTokenService.InternalTokenClaims verifyWithScope(HttpHeaders headers, String requiredScope) {
    JwtTokenService.InternalTokenClaims claims = verify(headers);
    Set<String> scopes = claims.scopes();
    if (requiredScope != null && !scopes.contains(requiredScope)) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN,
          "Internal JWT missing required scope: " + requiredScope);
    }
    return claims;
  }

  public String selfServiceName() { return selfServiceName; }
}
