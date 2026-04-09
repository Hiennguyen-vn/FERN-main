package com.natsu.common.utils.security;

import com.natsu.common.utils.services.timing.TimeService;
import com.natsu.common.utils.services.timing.TimeServiceImpl;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.security.KeyPair;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class OpaqueTokenCryptoTest {

    private KeyPair authKeyPair;
    private KeyPair servicesKeyPair;
    private TimeService timeService;

    @BeforeEach
    void setUp() {
        authKeyPair = OpaqueTokenCrypto.generateRsaKeyPair(2048);
        servicesKeyPair = OpaqueTokenCrypto.generateRsaKeyPair(2048);
        timeService = new TimeServiceImpl();
    }

    @Test
    void issueAndVerifyRoundTrip() {
        String token = OpaqueTokenCrypto.issue(
                authKeyPair.getPrivate(),
                servicesKeyPair.getPublic(),
                "user-123",
                "alice",
                List.of("auth.login", "dashboard.view"),
                3600_000L,
                timeService);
        assertNotNull(token);
        assertEquals(3, token.split("\\.").length, "Opaque token has signature.encKey.ciphertext");

        OpaqueTokenPayload payload = OpaqueTokenCrypto.verifyAndDecrypt(
                token,
                authKeyPair.getPublic(),
                servicesKeyPair.getPrivate(),
                timeService);
        assertEquals("user-123", payload.getSubject());
        assertEquals("alice", payload.getUsername());
        assertEquals(2, payload.getPermissions().size());
        assertTrue(payload.hasPermission("auth.login"));
        assertTrue(payload.hasPermission("dashboard.view"));
    }

    @Test
    void wrongServicesKeyCannotDecrypt() {
        KeyPair otherServices = OpaqueTokenCrypto.generateRsaKeyPair(2048);
        String token = OpaqueTokenCrypto.issue(
                authKeyPair.getPrivate(),
                servicesKeyPair.getPublic(),
                "user-1", "u", List.of(), 3600_000L, timeService);
        assertThrows(SecurityException.class, () ->
                OpaqueTokenCrypto.verifyAndDecrypt(
                        token, authKeyPair.getPublic(), otherServices.getPrivate(), timeService));
    }

    @Test
    void wrongAuthKeyFailsVerification() {
        KeyPair otherAuth = OpaqueTokenCrypto.generateRsaKeyPair(2048);
        String token = OpaqueTokenCrypto.issue(
                authKeyPair.getPrivate(),
                servicesKeyPair.getPublic(),
                "user-1", "u", List.of(), 3600_000L, timeService);
        assertThrows(SecurityException.class, () ->
                OpaqueTokenCrypto.verifyAndDecrypt(
                        token, otherAuth.getPublic(), servicesKeyPair.getPrivate(), timeService));
    }

    @Test
    void tamperedTokenFails() {
        String token = OpaqueTokenCrypto.issue(
                authKeyPair.getPrivate(),
                servicesKeyPair.getPublic(),
                "user-1", "u", List.of(), 3600_000L, timeService);
        String[] parts = token.split("\\.");
        String tampered = parts[0] + "." + parts[1] + "x." + parts[2];
        assertThrows(SecurityException.class, () ->
                OpaqueTokenCrypto.verifyAndDecrypt(
                        tampered, authKeyPair.getPublic(), servicesKeyPair.getPrivate(), timeService));
    }

    @Test
    void invalidFormatThrows() {
        assertThrows(SecurityException.class, () ->
                OpaqueTokenCrypto.verifyAndDecrypt(
                        "not.three.parts.here",
                        authKeyPair.getPublic(),
                        servicesKeyPair.getPrivate(),
                        timeService));
    }
}
