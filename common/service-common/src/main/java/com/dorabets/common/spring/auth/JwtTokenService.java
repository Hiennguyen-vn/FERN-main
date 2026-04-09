package com.dorabets.common.spring.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.natsu.common.utils.security.TokenUtil;
import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.JWSVerifier;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jose.crypto.MACVerifier;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

public class JwtTokenService {

  private static final String DEFAULT_ISSUER = "fern";
  private static final String DEFAULT_AUDIENCE = "fern-services";
  private static final int MIN_SECRET_BYTES = 32;

  private final byte[] secret;
  private final String issuer;
  private final String audience;

  public JwtTokenService(ObjectMapper objectMapper, String secret) {
    this(objectMapper, secret, System.getenv("JWT_ISSUER"), System.getenv("JWT_AUDIENCE"));
  }

  JwtTokenService(ObjectMapper objectMapper, String secret, String issuer, String audience) {
    this.secret = requireSecret(secret);
    this.issuer = normalizeOrDefault(issuer, DEFAULT_ISSUER);
    this.audience = normalizeOrDefault(audience, DEFAULT_AUDIENCE);
  }

  public String issueAccessToken(
      long userId,
      String username,
      String sessionId,
      Set<String> roles,
      Set<String> permissions,
      Set<Long> outletIds,
      long ttlSeconds
  ) {
    Instant now = Instant.now();
    String resolvedSessionId = sessionId != null ? sessionId : TokenUtil.generateRandomToken(24);

    JWTClaimsSet claimsSet = new JWTClaimsSet.Builder()
        .issuer(issuer)
        .audience(audience)
        .subject(Long.toString(userId))
        .claim("uid", userId)
        .claim("username", username)
        .claim("sid", resolvedSessionId)
        .claim("roles", orderedStrings(roles))
        .claim("permissions", orderedStrings(permissions))
        .claim("outletIds", orderedLongs(outletIds))
        .issueTime(Date.from(now))
        .expirationTime(Date.from(now.plusSeconds(ttlSeconds)))
        .build();

    try {
      SignedJWT signedJwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claimsSet);
      signedJwt.sign(new MACSigner(secret));
      return signedJwt.serialize();
    } catch (JOSEException e) {
      throw new IllegalStateException("Unable to issue JWT", e);
    }
  }

  public JwtClaims verify(String token) {
    try {
      SignedJWT signedJwt = SignedJWT.parse(token);
      JWSVerifier verifier = new MACVerifier(secret);
      if (!signedJwt.verify(verifier)) {
        throw new IllegalArgumentException("Invalid JWT signature");
      }

      JWTClaimsSet claimsSet = signedJwt.getJWTClaimsSet();
      if (!issuer.equals(claimsSet.getIssuer())) {
        throw new IllegalArgumentException("Invalid JWT issuer");
      }
      if (claimsSet.getAudience() == null || !claimsSet.getAudience().contains(audience)) {
        throw new IllegalArgumentException("Invalid JWT audience");
      }

      Instant now = Instant.now();
      Instant issuedAt = claimsSet.getIssueTime() == null ? now : claimsSet.getIssueTime().toInstant();
      Instant expiresAt = claimsSet.getExpirationTime() == null ? now : claimsSet.getExpirationTime().toInstant();
      JwtClaims claims = new JwtClaims(
          claimsSet.getLongClaim("uid") != null
              ? claimsSet.getLongClaim("uid")
              : Long.parseLong(claimsSet.getSubject()),
          claimsSet.getStringClaim("username"),
          claimsSet.getStringClaim("sid"),
          asStringSet(claimsSet.getClaim("roles")),
          asStringSet(claimsSet.getClaim("permissions")),
          asLongSet(claimsSet.getClaim("outletIds")),
          issuedAt,
          expiresAt
      );
      if (claims.isExpired(now)) {
        throw new IllegalArgumentException("JWT expired");
      }
      return claims;
    } catch (Exception e) {
      throw new IllegalArgumentException("Unable to verify JWT: " + e.getMessage(), e);
    }
  }

  private static byte[] requireSecret(String configuredSecret) {
    if (configuredSecret == null || configuredSecret.isBlank()) {
      throw new IllegalStateException("JWT_SECRET must be configured");
    }
    byte[] resolved = configuredSecret.getBytes(StandardCharsets.UTF_8);
    if (resolved.length < MIN_SECRET_BYTES) {
      throw new IllegalStateException("JWT_SECRET must be at least " + MIN_SECRET_BYTES + " bytes");
    }
    return resolved;
  }

  private static String normalizeOrDefault(String value, String fallback) {
    if (value == null || value.isBlank()) {
      return fallback;
    }
    return value.trim();
  }

  private static List<String> orderedStrings(Set<String> values) {
    if (values == null || values.isEmpty()) {
      return List.of();
    }
    return new ArrayList<>(new LinkedHashSet<>(values));
  }

  private static List<Long> orderedLongs(Set<Long> values) {
    if (values == null || values.isEmpty()) {
      return List.of();
    }
    return new ArrayList<>(new LinkedHashSet<>(values));
  }

  private static Set<String> asStringSet(Object rawValue) {
    if (!(rawValue instanceof List<?> rawList)) {
      return Set.of();
    }
    LinkedHashSet<String> values = new LinkedHashSet<>();
    for (Object item : rawList) {
      if (item == null) {
        continue;
      }
      String value = String.valueOf(item).trim();
      if (!value.isEmpty()) {
        values.add(value);
      }
    }
    return Set.copyOf(values);
  }

  private static Set<Long> asLongSet(Object rawValue) {
    if (!(rawValue instanceof List<?> rawList)) {
      return Set.of();
    }
    LinkedHashSet<Long> values = new LinkedHashSet<>();
    for (Object item : rawList) {
      if (item instanceof Number number) {
        values.add(number.longValue());
        continue;
      }
      if (item != null) {
        String value = String.valueOf(item).trim();
        if (!value.isEmpty()) {
          values.add(Long.parseLong(value));
        }
      }
    }
    return Set.copyOf(values);
  }
}
