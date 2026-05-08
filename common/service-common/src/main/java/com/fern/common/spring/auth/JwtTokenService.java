package com.fern.common.spring.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fern.common.utils.security.TokenUtil;
import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.JWSSigner;
import com.nimbusds.jose.JWSVerifier;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jose.crypto.MACVerifier;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

public class JwtTokenService {

  private static final String DEFAULT_ISSUER = "fern";
  private static final String DEFAULT_AUDIENCE = "fern-services";
  private static final int MIN_SECRET_BYTES = 32;
  private static final long EXPIRATION_CLOCK_SKEW_SECONDS = 60;
  public static final String DEFAULT_KEY_ID = "fern-rsa-1";

  public enum Algorithm { HS256, RS256 }

  private final Algorithm algorithm;
  private final byte[] secret;
  private final RSAPrivateKey rsaPrivateKey;
  private final RSAPublicKey rsaPublicKey;
  private final String keyId;
  private final String issuer;
  private final String audience;

  public JwtTokenService(ObjectMapper objectMapper, String secret) {
    this(objectMapper, secret, System.getenv("JWT_ISSUER"), System.getenv("JWT_AUDIENCE"));
  }

  JwtTokenService(ObjectMapper objectMapper, String secret, String issuer, String audience) {
    this.algorithm = Algorithm.HS256;
    this.secret = requireSecret(secret);
    this.rsaPrivateKey = null;
    this.rsaPublicKey = null;
    this.keyId = null;
    this.issuer = normalizeOrDefault(issuer, DEFAULT_ISSUER);
    this.audience = normalizeOrDefault(audience, DEFAULT_AUDIENCE);
  }

  public JwtTokenService(Algorithm algorithm, byte[] secret, RSAPrivateKey rsaPrivateKey,
      RSAPublicKey rsaPublicKey, String keyId, String issuer, String audience) {
    this.algorithm = algorithm == null ? Algorithm.HS256 : algorithm;
    this.secret = secret;
    this.rsaPrivateKey = rsaPrivateKey;
    this.rsaPublicKey = rsaPublicKey;
    this.keyId = keyId == null || keyId.isBlank() ? DEFAULT_KEY_ID : keyId;
    this.issuer = normalizeOrDefault(issuer, DEFAULT_ISSUER);
    this.audience = normalizeOrDefault(audience, DEFAULT_AUDIENCE);
    if (this.algorithm == Algorithm.RS256 && (rsaPrivateKey == null || rsaPublicKey == null)) {
      throw new IllegalStateException("RS256 requires RSA private and public keys");
    }
    if (this.algorithm == Algorithm.HS256 && (secret == null || secret.length < MIN_SECRET_BYTES)) {
      throw new IllegalStateException("HS256 requires JWT_SECRET >= " + MIN_SECRET_BYTES + " bytes");
    }
  }

  public Algorithm algorithm() { return algorithm; }
  public RSAPublicKey rsaPublicKey() { return rsaPublicKey; }
  public String keyId() { return keyId; }

  public String issueDeviceToken(long deviceId, long outletId, long ttlSeconds) {
    Instant now = Instant.now();
    JWTClaimsSet claimsSet = new JWTClaimsSet.Builder()
        .issuer(issuer)
        .audience(audience)
        .subject("device:" + deviceId)
        .claim("device_id", deviceId)
        .claim("device_outlet_id", outletId)
        .issueTime(Date.from(now))
        .expirationTime(Date.from(now.plusSeconds(ttlSeconds)))
        .build();
    return sign(claimsSet, "Unable to issue device JWT");
  }

  /**
   * Issue internal service-to-service token. aud=callee, scope=requested capabilities.
   * Subject = "service:<callerService>" so verifier can attribute calls.
   */
  public String issueInternalToken(String callerService, String callee, Set<String> scopes, long ttlSeconds) {
    Instant now = Instant.now();
    JWTClaimsSet claimsSet = new JWTClaimsSet.Builder()
        .issuer(issuer)
        .audience(callee)
        .subject("service:" + callerService)
        .claim("caller_service", callerService)
        .claim("scope", scopes == null ? "" : String.join(" ", new java.util.TreeSet<>(scopes)))
        .claim("token_use", "internal")
        .issueTime(Date.from(now))
        .expirationTime(Date.from(now.plusSeconds(ttlSeconds)))
        .build();
    return sign(claimsSet, "Unable to issue internal JWT");
  }

  /**
   * Verify internal token: signature, expiry, aud == expectedCallee, token_use=internal.
   * Returns parsed internal claims. Throws IllegalArgumentException on any failure.
   */
  public InternalTokenClaims verifyInternalToken(String token, String expectedCallee) {
    try {
      SignedJWT signedJwt = SignedJWT.parse(token);
      JWSAlgorithm tokenAlg = signedJwt.getHeader().getAlgorithm();
      JWSVerifier verifier;
      if (JWSAlgorithm.RS256.equals(tokenAlg) && rsaPublicKey != null) {
        verifier = new RSASSAVerifier(rsaPublicKey);
      } else if (JWSAlgorithm.HS256.equals(tokenAlg) && secret != null) {
        verifier = new MACVerifier(secret);
      } else {
        throw new IllegalArgumentException("Unsupported internal JWT algorithm: " + tokenAlg);
      }
      if (!signedJwt.verify(verifier)) {
        throw new IllegalArgumentException("Invalid internal JWT signature");
      }
      JWTClaimsSet claims = signedJwt.getJWTClaimsSet();
      if (!issuer.equals(claims.getIssuer())) {
        throw new IllegalArgumentException("Invalid internal JWT issuer");
      }
      if (!"internal".equals(claims.getStringClaim("token_use"))) {
        throw new IllegalArgumentException("Token is not an internal service token");
      }
      if (claims.getAudience() == null || !claims.getAudience().contains(expectedCallee)) {
        throw new IllegalArgumentException("Internal JWT audience mismatch");
      }
      Instant exp = claims.getExpirationTime() == null ? Instant.now() : claims.getExpirationTime().toInstant();
      if (exp.isBefore(Instant.now().minusSeconds(EXPIRATION_CLOCK_SKEW_SECONDS))) {
        throw new IllegalArgumentException("Internal JWT expired");
      }
      String callerService = claims.getStringClaim("caller_service");
      String scope = claims.getStringClaim("scope");
      Set<String> scopes = (scope == null || scope.isBlank())
          ? Set.of()
          : Set.copyOf(java.util.Arrays.asList(scope.split(" ")));
      return new InternalTokenClaims(callerService, scopes, exp);
    } catch (Exception e) {
      throw new IllegalArgumentException("Unable to verify internal JWT: " + e.getMessage(), e);
    }
  }

  public record InternalTokenClaims(String callerService, Set<String> scopes, Instant expiresAt) {}

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
    return sign(claimsSet, "Unable to issue JWT");
  }

  private String sign(JWTClaimsSet claimsSet, String errorMessage) {
    try {
      JWSHeader header;
      JWSSigner signer;
      if (algorithm == Algorithm.RS256) {
        header = new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(keyId).build();
        signer = new RSASSASigner(rsaPrivateKey);
      } else {
        header = new JWSHeader(JWSAlgorithm.HS256);
        signer = new MACSigner(secret);
      }
      SignedJWT signedJwt = new SignedJWT(header, claimsSet);
      signedJwt.sign(signer);
      return signedJwt.serialize();
    } catch (JOSEException e) {
      throw new IllegalStateException(errorMessage, e);
    }
  }

  public JwtClaims verify(String token) {
    try {
      SignedJWT signedJwt = SignedJWT.parse(token);
      JWSAlgorithm tokenAlg = signedJwt.getHeader().getAlgorithm();
      JWSVerifier verifier;
      if (JWSAlgorithm.RS256.equals(tokenAlg) && rsaPublicKey != null) {
        verifier = new RSASSAVerifier(rsaPublicKey);
      } else if (JWSAlgorithm.HS256.equals(tokenAlg) && secret != null) {
        verifier = new MACVerifier(secret);
      } else {
        throw new IllegalArgumentException("Unsupported JWT algorithm: " + tokenAlg);
      }
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
      Long deviceId = claimsSet.getLongClaim("device_id");
      Long deviceOutletId = claimsSet.getLongClaim("device_outlet_id");
      Long userId = claimsSet.getLongClaim("uid");
      if (userId == null && deviceId == null) {
        String subject = claimsSet.getSubject();
        if (subject != null && !subject.startsWith("device:")) {
          userId = Long.parseLong(subject);
        }
      }
      JwtClaims claims = new JwtClaims(
          userId,
          claimsSet.getStringClaim("username"),
          claimsSet.getStringClaim("sid"),
          asRoleSet(claimsSet.getClaim("roles")),
          asStringSet(claimsSet.getClaim("permissions")),
          asLongSet(claimsSet.getClaim("outletIds")),
          deviceId,
          deviceOutletId,
          issuedAt,
          expiresAt
      );
      if (claims.isExpired(now.minusSeconds(EXPIRATION_CLOCK_SKEW_SECONDS))) {
        throw new IllegalArgumentException("JWT expired");
      }
      return claims;
    } catch (Exception e) {
      throw new IllegalArgumentException("Unable to verify JWT: " + e.getMessage(), e);
    }
  }

  public static RSAPrivateKey parseRsaPrivateKey(String pem) {
    try {
      String body = pem.replaceAll("-----BEGIN [A-Z ]+-----", "")
          .replaceAll("-----END [A-Z ]+-----", "")
          .replaceAll("\\s", "");
      byte[] decoded = Base64.getDecoder().decode(body);
      KeyFactory factory = KeyFactory.getInstance("RSA");
      return (RSAPrivateKey) factory.generatePrivate(new PKCS8EncodedKeySpec(decoded));
    } catch (Exception e) {
      throw new IllegalStateException("Invalid RSA private key PEM", e);
    }
  }

  public static RSAPublicKey parseRsaPublicKey(String pem) {
    try {
      String body = pem.replaceAll("-----BEGIN [A-Z ]+-----", "")
          .replaceAll("-----END [A-Z ]+-----", "")
          .replaceAll("\\s", "");
      byte[] decoded = Base64.getDecoder().decode(body);
      KeyFactory factory = KeyFactory.getInstance("RSA");
      return (RSAPublicKey) factory.generatePublic(new X509EncodedKeySpec(decoded));
    } catch (Exception e) {
      throw new IllegalStateException("Invalid RSA public key PEM", e);
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

  /** Canonical role names for RBAC (match Python policy / Spring AuthorizationPolicyService). */
  private static Set<String> asRoleSet(Object rawValue) {
    Set<String> base = asStringSet(rawValue);
    if (base.isEmpty()) {
      return base;
    }
    LinkedHashSet<String> values = new LinkedHashSet<>();
    for (String r : base) {
      values.add(r.toLowerCase(Locale.ROOT));
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
