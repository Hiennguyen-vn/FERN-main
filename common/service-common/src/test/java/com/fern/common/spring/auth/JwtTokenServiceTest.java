package com.fern.common.spring.auth;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.Set;
import org.junit.jupiter.api.Test;

class JwtTokenServiceTest {

  private static final String SECRET = "test-jwt-secret-should-be-at-least-64-bytes-for-hs384-coverage";

  @Test
  void verifyAcceptsHs256Token() {
    JwtTokenService service = new JwtTokenService(new ObjectMapper().findAndRegisterModules(), SECRET);

    String token = service.issueAccessToken(
        1001L, "cashier", "session-1001", Set.of("staff"), Set.of("sales.order.write"), Set.of(7L), 3600);

    JwtClaims claims = service.verify(token);

    assertEquals(1001L, claims.userId());
    assertEquals("session-1001", claims.sessionId());
  }

  @Test
  void verifyRejectsUnsignedNoneAlgorithmTokenBeforeSignatureVerification() {
    JwtTokenService service = new JwtTokenService(new ObjectMapper().findAndRegisterModules(), SECRET);
    String token = base64Url("{\"alg\":\"none\"}") + "." + base64Url("""
        {"iss":"fern","aud":["fern-services"],"sub":"1001","uid":1001,"exp":4102444800}
        """) + ".";

    assertThrows(IllegalArgumentException.class, () -> service.verify(token));
  }

  @Test
  void verifyRejectsSignedTokenWithWrongHmacAlgorithm() throws Exception {
    JwtTokenService service = new JwtTokenService(new ObjectMapper().findAndRegisterModules(), SECRET);
    String token = signedToken(JWSAlgorithm.HS384, Instant.now().plusSeconds(3600));

    assertThrows(IllegalArgumentException.class, () -> service.verify(token));
  }

  @Test
  void verifyRejectsMalformedToken() {
    JwtTokenService service = new JwtTokenService(new ObjectMapper().findAndRegisterModules(), SECRET);

    assertThrows(IllegalArgumentException.class, () -> service.verify("not-a-jwt"));
  }

  @Test
  void verifyAllowsExpiryWithinClockSkewOnly() throws Exception {
    JwtTokenService service = new JwtTokenService(new ObjectMapper().findAndRegisterModules(), SECRET);

    JwtClaims withinSkew = service.verify(signedToken(JWSAlgorithm.HS256, Instant.now().minusSeconds(30)));
    assertEquals(1001L, withinSkew.userId());

    String outsideSkew = signedToken(JWSAlgorithm.HS256, Instant.now().minusSeconds(120));
    assertThrows(IllegalArgumentException.class, () -> service.verify(outsideSkew));
  }

  private static String signedToken(JWSAlgorithm algorithm, Instant expiresAt) throws JOSEException {
    Instant now = Instant.now();
    JWTClaimsSet claims = new JWTClaimsSet.Builder()
        .issuer("fern")
        .audience("fern-services")
        .subject("1001")
        .claim("uid", 1001L)
        .claim("username", "cashier")
        .claim("sid", "session-1001")
        .claim("roles", java.util.List.of("staff"))
        .claim("permissions", java.util.List.of("sales.order.write"))
        .claim("outletIds", java.util.List.of(7L))
        .issueTime(Date.from(now.minusSeconds(5)))
        .expirationTime(Date.from(expiresAt))
        .build();
    SignedJWT jwt = new SignedJWT(new JWSHeader(algorithm), claims);
    jwt.sign(new MACSigner(SECRET.getBytes(StandardCharsets.UTF_8)));
    return jwt.serialize();
  }

  private static String base64Url(String value) {
    return Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString(value.strip().getBytes(StandardCharsets.UTF_8));
  }
}
