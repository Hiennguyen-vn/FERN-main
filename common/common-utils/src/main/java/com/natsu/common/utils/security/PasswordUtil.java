package com.natsu.common.utils.security;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.security.spec.InvalidKeySpecException;
import java.util.Base64;

/**
 * Utility for secure password hashing using PBKDF2WithHmacSHA256.
 *
 * <p>
 * Usage:
 * 
 * <pre>{@code
 * // Hash a password (auto-generates salt, returns "salt:hash")
 * String stored = PasswordUtil.hashPassword("myPassword");
 *
 * // Verify a password against a stored hash
 * boolean valid = PasswordUtil.verifyPassword("myPassword", stored);
 *
 * // Low-level API with explicit salt
 * byte[] salt = PasswordUtil.generateSalt();
 * String hash = PasswordUtil.hashPassword("myPassword".toCharArray(), salt);
 * }</pre>
 */
public final class PasswordUtil {
    private static final SecureRandom RAND = new SecureRandom();
    private static final int ITERATIONS = 65536;
    private static final int KEY_LENGTH = 256;
    private static final int SALT_LENGTH = 16;
    private static final String SEPARATOR = ":";

    private PasswordUtil() {
        // prevent instantiation
    }

    /**
     * Hashes a password with an explicit salt.
     *
     * @param password the password as a char array
     * @param salt     the salt bytes
     * @return the Base64-encoded hash
     * @throws NoSuchAlgorithmException if PBKDF2WithHmacSHA256 is not available
     * @throws InvalidKeySpecException  if the key spec is invalid
     */
    public static String hash(char[] password, byte[] salt)
            throws NoSuchAlgorithmException, InvalidKeySpecException {
        PBEKeySpec spec = new PBEKeySpec(password, salt, ITERATIONS, KEY_LENGTH);
        try {
            SecretKeyFactory skf = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
            byte[] hash = skf.generateSecret(spec).getEncoded();
            return Base64.getEncoder().encodeToString(hash);
        } finally {
            spec.clearPassword();
        }
    }

    /**
     * Hashes a password with an auto-generated salt.
     * Returns a string in the format {@code base64(salt):base64(hash)} suitable for
     * storage.
     *
     * @param password the plaintext password
     * @return the salt:hash string
     * @throws NoSuchAlgorithmException if PBKDF2WithHmacSHA256 is not available
     * @throws InvalidKeySpecException  if the key spec is invalid
     */
    public static String hash(String password)
            throws NoSuchAlgorithmException, InvalidKeySpecException {
        byte[] salt = generateSalt();
        String hash = hash(password.toCharArray(), salt);
        return Base64.getEncoder().encodeToString(salt) + SEPARATOR + hash;
    }

    /**
     * Verifies a plaintext password against a stored salt:hash string
     * produced by {@link #hash(String)}.
     *
     * <p>
     * Uses constant-time comparison to prevent timing attacks.
     *
     * @param password the plaintext password to verify
     * @param stored   the stored "salt:hash" string
     * @return {@code true} if the password matches
     * @throws NoSuchAlgorithmException if PBKDF2WithHmacSHA256 is not available
     * @throws InvalidKeySpecException  if the key spec is invalid
     * @throws IllegalArgumentException if the stored string format is invalid
     */
    public static boolean verifyPassword(String password, String stored)
            throws NoSuchAlgorithmException, InvalidKeySpecException {
        int separatorIndex = stored.indexOf(SEPARATOR);
        if (separatorIndex < 0) {
            throw new IllegalArgumentException("Invalid stored password format: missing separator");
        }
        String saltBase64 = stored.substring(0, separatorIndex);
        String expectedHash = stored.substring(separatorIndex + 1);

        byte[] salt = Base64.getDecoder().decode(saltBase64);
        String actualHash = hash(password.toCharArray(), salt);

        // Constant-time comparison to prevent timing attacks
        return MessageDigest.isEqual(
                expectedHash.getBytes(java.nio.charset.StandardCharsets.UTF_8),
                actualHash.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }

    /**
     * Generates a cryptographically secure random salt.
     *
     * @return a random salt byte array
     */
    public static byte[] generateSalt() {
        byte[] salt = new byte[SALT_LENGTH];
        RAND.nextBytes(salt);
        return salt;
    }
}
