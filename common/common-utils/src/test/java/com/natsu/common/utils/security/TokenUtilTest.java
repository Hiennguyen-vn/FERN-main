package com.natsu.common.utils.security;

import org.junit.jupiter.api.RepeatedTest;
import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for TokenUtil.
 */
class TokenUtilTest {

    @Test
    void testGenerateTokenLength() {
        String token = TokenUtil.generateRandomToken(32);
        assertEquals(32, token.length());
    }

    @Test
    void testGenerateTokenAlphanumeric() {
        String token = TokenUtil.generateRandomToken(100);
        assertTrue(token.matches("[0-9A-Za-z]+"), "Token should be alphanumeric only");
    }

    @Test
    void testGenerateTokenUniqueness() {
        Set<String> tokens = new HashSet<>();
        for (int i = 0; i < 100; i++) {
            tokens.add(TokenUtil.generateRandomToken(32));
        }
        // All 100 should be unique (probability of collision is astronomically low)
        assertEquals(100, tokens.size());
    }

    @Test
    void testGenerateTokenMinLength() {
        String token = TokenUtil.generateRandomToken(1);
        assertEquals(1, token.length());
        assertTrue(token.matches("[0-9A-Za-z]"));
    }

    @Test
    void testGenerateTokenZeroLength() {
        String token = TokenUtil.generateRandomToken(0);
        assertEquals(0, token.length());
        assertEquals("", token);
    }

    @RepeatedTest(10)
    void testTokensAreRandom() {
        String token1 = TokenUtil.generateRandomToken(64);
        String token2 = TokenUtil.generateRandomToken(64);
        assertNotEquals(token1, token2);
    }
}
