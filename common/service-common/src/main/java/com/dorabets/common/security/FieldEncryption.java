package com.dorabets.common.security;

import com.dorabets.common.config.RuntimeEnvironment;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * Symmetric field-level encryption for sensitive application data stored in PostgreSQL.
 */
public final class FieldEncryption {

    public static final String ENV_KEY = "DORABETS_FIELD_ENCRYPTION_KEY";

    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final String KEY_ALGO = "AES";
    private static final int GCM_TAG_BITS = 128;
    private static final int IV_LENGTH = 12;
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();
    private static final byte[] DEV_FALLBACK_SALT =
            "dorabets-dev-field-encryption".getBytes(StandardCharsets.UTF_8);

    private final SecretKeySpec keySpec;

    private FieldEncryption(byte[] rawKey) {
        this.keySpec = new SecretKeySpec(rawKey, KEY_ALGO);
    }

    public static FieldEncryption configured() {
        String configured = System.getenv(ENV_KEY);
        if (configured != null && !configured.isBlank()) {
            return fromKeyMaterial(configured);
        }
        if (RuntimeEnvironment.isDevelopment()) {
            return new FieldEncryption(sha256(DEV_FALLBACK_SALT));
        }
        throw new IllegalStateException(
                ENV_KEY + " must be configured outside development for encrypted field access");
    }

    public static FieldEncryption fromKeyMaterial(String keyMaterial) {
        byte[] decoded = decodeKeyMaterial(keyMaterial);
        if (decoded.length < 32) {
            throw new IllegalArgumentException("Field encryption key must be at least 32 bytes");
        }
        byte[] rawKey = decoded.length == 32 ? decoded : sha256(decoded);
        return new FieldEncryption(rawKey);
    }

    public String encrypt(String plaintext) {
        if (plaintext == null) {
            return null;
        }
        try {
            byte[] iv = new byte[IV_LENGTH];
            SECURE_RANDOM.nextBytes(iv);

            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, keySpec, new GCMParameterSpec(GCM_TAG_BITS, iv));
            byte[] ciphertext = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));

            byte[] packed = new byte[iv.length + ciphertext.length];
            System.arraycopy(iv, 0, packed, 0, iv.length);
            System.arraycopy(ciphertext, 0, packed, iv.length, ciphertext.length);
            return Base64.getEncoder().encodeToString(packed);
        } catch (Exception e) {
            throw new SecurityException("Failed to encrypt field", e);
        }
    }

    public String decrypt(String ciphertext) {
        if (ciphertext == null || ciphertext.isBlank()) {
            return null;
        }
        try {
            byte[] packed = Base64.getDecoder().decode(ciphertext);
            if (packed.length <= IV_LENGTH) {
                throw new SecurityException("Encrypted field payload is malformed");
            }
            byte[] iv = new byte[IV_LENGTH];
            byte[] encrypted = new byte[packed.length - IV_LENGTH];
            System.arraycopy(packed, 0, iv, 0, IV_LENGTH);
            System.arraycopy(packed, IV_LENGTH, encrypted, 0, encrypted.length);

            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, keySpec, new GCMParameterSpec(GCM_TAG_BITS, iv));
            byte[] plaintext = cipher.doFinal(encrypted);
            return new String(plaintext, StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new SecurityException("Failed to decrypt field", e);
        }
    }

    private static byte[] decodeKeyMaterial(String keyMaterial) {
        String trimmed = keyMaterial.trim();
        try {
            return Base64.getDecoder().decode(trimmed);
        } catch (IllegalArgumentException ignored) {
            return trimmed.getBytes(StandardCharsets.UTF_8);
        }
    }

    private static byte[] sha256(byte[] input) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(input);
        } catch (Exception e) {
            throw new SecurityException("SHA-256 unavailable", e);
        }
    }
}
