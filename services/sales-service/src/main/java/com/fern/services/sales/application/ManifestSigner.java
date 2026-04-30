package com.fern.services.sales.application;

import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Base64;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Signs sync manifests with Ed25519 so edge clients can verify integrity + authenticity
 * before accepting catalog/price versions. Private key supplied as PKCS#8 base64 via env.
 * If unset, signing is disabled (manifest returned unsigned — edge accepts in dev mode).
 */
@Component
public class ManifestSigner {

  private final PrivateKey privateKey;
  private final String keyId;

  public ManifestSigner(
      @Value("${fern.sync.manifest-private-key-pkcs8-b64:}") String pkcs8Base64,
      @Value("${fern.sync.manifest-key-id:dev-key}") String keyId
  ) {
    this.keyId = keyId;
    PrivateKey key = null;
    if (pkcs8Base64 != null && !pkcs8Base64.isBlank()) {
      try {
        byte[] der = Base64.getDecoder().decode(pkcs8Base64);
        KeyFactory kf = KeyFactory.getInstance("Ed25519");
        key = kf.generatePrivate(new PKCS8EncodedKeySpec(der));
      } catch (Exception e) {
        // log + leave disabled
        key = null;
      }
    }
    this.privateKey = key;
  }

  public boolean isEnabled() {
    return privateKey != null;
  }

  public String keyId() {
    return keyId;
  }

  public String sign(String canonical) {
    if (privateKey == null) return null;
    try {
      Signature sig = Signature.getInstance("Ed25519");
      sig.initSign(privateKey);
      sig.update(canonical.getBytes(java.nio.charset.StandardCharsets.UTF_8));
      return Base64.getEncoder().encodeToString(sig.sign());
    } catch (Exception e) {
      return null;
    }
  }

  public static String canonicalize(long catalog, long price, long stock, long recipe, long menu, String serverTime) {
    return catalog + "|" + price + "|" + stock + "|" + recipe + "|" + menu + "|" + serverTime;
  }
}
