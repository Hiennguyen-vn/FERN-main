package com.fern.services.sales.application;

import static org.junit.jupiter.api.Assertions.*;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PublicKey;
import java.security.Signature;
import java.util.Base64;
import org.junit.jupiter.api.Test;

class ManifestSignerTest {

  @Test
  void disabledWhenKeyMissing() {
    ManifestSigner s = new ManifestSigner("", "k1");
    assertFalse(s.isEnabled());
    assertNull(s.sign("anything"));
  }

  @Test
  void signsAndVerifiesEd25519() throws Exception {
    KeyPair kp = KeyPairGenerator.getInstance("Ed25519").generateKeyPair();
    String pkcs8 = Base64.getEncoder().encodeToString(kp.getPrivate().getEncoded());
    ManifestSigner signer = new ManifestSigner(pkcs8, "k1");
    assertTrue(signer.isEnabled());
    String canonical = ManifestSigner.canonicalize(1, 2, 3, 4, 5, "2026-04-28T00:00:00Z");
    String sig = signer.sign(canonical);
    assertNotNull(sig);

    Signature v = Signature.getInstance("Ed25519");
    PublicKey pub = kp.getPublic();
    v.initVerify(pub);
    v.update(canonical.getBytes("UTF-8"));
    assertTrue(v.verify(Base64.getDecoder().decode(sig)));
  }

  @Test
  void signatureChangesWhenAnyVersionChanges() throws Exception {
    KeyPair kp = KeyPairGenerator.getInstance("Ed25519").generateKeyPair();
    String pkcs8 = Base64.getEncoder().encodeToString(kp.getPrivate().getEncoded());
    ManifestSigner signer = new ManifestSigner(pkcs8, "k1");
    String a = signer.sign(ManifestSigner.canonicalize(1, 2, 3, 4, 5, "t"));
    String b = signer.sign(ManifestSigner.canonicalize(1, 2, 3, 4, 6, "t"));
    assertNotEquals(a, b);
  }

  @Test
  void canonicalizeIsStable() {
    String c1 = ManifestSigner.canonicalize(10, 20, 30, 40, 50, "T");
    String c2 = ManifestSigner.canonicalize(10, 20, 30, 40, 50, "T");
    assertEquals(c1, c2);
    assertEquals("10|20|30|40|50|T", c1);
  }
}
