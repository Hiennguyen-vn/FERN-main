package com.natsu.common.utils.security;

import org.junit.jupiter.api.RepeatedTest;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for PasswordUtil.
 */
class PasswordUtilTest {

    @Test
    void testHashWithSalt() throws Exception {
        byte[] salt = PasswordUtil.generateSalt();
        String hash = PasswordUtil.hash("password123".toCharArray(), salt);

        assertNotNull(hash);
        assertFalse(hash.isBlank());
    }

    @Test
    void testSamePasswordSameSaltProducesSameHash() throws Exception {
        byte[] salt = PasswordUtil.generateSalt();
        String hash1 = PasswordUtil.hash("password123".toCharArray(), salt);
        String hash2 = PasswordUtil.hash("password123".toCharArray(), salt);

        assertEquals(hash1, hash2);
    }

    @Test
    void testDifferentSaltProducesDifferentHash() throws Exception {
        byte[] salt1 = PasswordUtil.generateSalt();
        byte[] salt2 = PasswordUtil.generateSalt();
        String hash1 = PasswordUtil.hash("password123".toCharArray(), salt1);
        String hash2 = PasswordUtil.hash("password123".toCharArray(), salt2);

        assertNotEquals(hash1, hash2);
    }

    @Test
    void testHashConvenience() throws Exception {
        String stored = PasswordUtil.hash("mySecret");

        assertNotNull(stored);
        assertTrue(stored.contains(":"), "Should contain salt:hash separator");
    }

    @Test
    void testVerifyPasswordCorrect() throws Exception {
        String stored = PasswordUtil.hash("mySecret");

        assertTrue(PasswordUtil.verifyPassword("mySecret", stored));
    }

    @Test
    void testVerifyPasswordIncorrect() throws Exception {
        String stored = PasswordUtil.hash("mySecret");

        assertFalse(PasswordUtil.verifyPassword("wrongPassword", stored));
    }

    @Test
    void testVerifyPasswordEmptyPassword() throws Exception {
        String stored = PasswordUtil.hash("");

        assertTrue(PasswordUtil.verifyPassword("", stored));
        assertFalse(PasswordUtil.verifyPassword("notempty", stored));
    }

    @Test
    void testVerifyPasswordInvalidFormat() {
        assertThrows(IllegalArgumentException.class,
                () -> PasswordUtil.verifyPassword("pass", "invalidFormatNoSeparator"));
    }

    @RepeatedTest(5)
    void testGenerateSaltUniqueness() {
        byte[] salt1 = PasswordUtil.generateSalt();
        byte[] salt2 = PasswordUtil.generateSalt();

        assertNotNull(salt1);
        assertNotNull(salt2);
        assertEquals(16, salt1.length);
        assertEquals(16, salt2.length);
        assertFalse(java.util.Arrays.equals(salt1, salt2), "Salts should be unique");
    }

    @Test
    void testHashDeterministic() throws Exception {
        // Multiple calls with same input and salt should produce same result
        String stored1 = PasswordUtil.hash("test");
        String stored2 = PasswordUtil.hash("test");

        // Different salts, so stored values should differ
        assertNotEquals(stored1, stored2);

        // But each should verify against the original password
        assertTrue(PasswordUtil.verifyPassword("test", stored1));
        assertTrue(PasswordUtil.verifyPassword("test", stored2));
    }
}
