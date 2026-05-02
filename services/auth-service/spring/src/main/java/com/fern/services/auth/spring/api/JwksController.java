package com.fern.services.auth.spring.api;

import com.fern.common.spring.auth.JwtTokenService;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.KeyUse;
import com.nimbusds.jose.jwk.RSAKey;
import java.security.interfaces.RSAPublicKey;
import java.util.Map;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class JwksController {

  private final JwtTokenService jwtTokenService;

  public JwksController(JwtTokenService jwtTokenService) {
    this.jwtTokenService = jwtTokenService;
  }

  @GetMapping(value = {"/.well-known/jwks.json", "/api/v1/auth/.well-known/jwks.json"},
      produces = MediaType.APPLICATION_JSON_VALUE)
  public ResponseEntity<Map<String, Object>> jwks() {
    if (jwtTokenService.algorithm() != JwtTokenService.Algorithm.RS256
        || jwtTokenService.rsaPublicKey() == null) {
      return ResponseEntity.ok(Map.of("keys", java.util.List.of()));
    }
    RSAPublicKey pub = jwtTokenService.rsaPublicKey();
    RSAKey jwk = new RSAKey.Builder(pub)
        .keyID(jwtTokenService.keyId())
        .keyUse(KeyUse.SIGNATURE)
        .algorithm(com.nimbusds.jose.JWSAlgorithm.RS256)
        .build();
    JWKSet set = new JWKSet(jwk);
    return ResponseEntity.ok(set.toJSONObject(true));
  }
}
