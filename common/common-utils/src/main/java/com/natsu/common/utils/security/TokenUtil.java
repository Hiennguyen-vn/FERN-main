package com.natsu.common.utils.security;

import java.security.SecureRandom;

/**
 * Utility for generating cryptographically secure random alphanumeric tokens.
 *
 * <p>
 * Usage:
 *
 * <pre>{@code
 * // Generate a 32-character random token
 * String token = TokenUtil.generateRandomToken(32);
 * }</pre>
 */
public final class TokenUtil {
    private static final SecureRandom RAND = new SecureRandom();
    private static final char[] ALPHANUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
            .toCharArray();

    private TokenUtil() {
        // prevent instantiation
    }

    /**
     * Generates a cryptographically secure random alphanumeric token.
     *
     * @param length the desired token length
     * @return a random alphanumeric token string
     */
    public static String generateRandomToken(int length) {
        char[] token = new char[length];
        for (int i = 0; i < length; i++) {
            token[i] = ALPHANUM[RAND.nextInt(ALPHANUM.length)];
        }
        return new String(token);
    }
}
