package com.natsu.common.utils.security;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.natsu.common.utils.services.timing.TimeService;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.AlgorithmParameterSpec;
import java.util.Base64;
import java.util.List;

/**
 * Issues and verifies opaque asymmetric tokens. Tokens are encrypted and signed
 * so that clients cannot read or tamper with them; only the auth service (issuer)
 * and backend services (verifier) can decrypt and verify.
 * <p>
 * Flow:
 * <ul>
 *   <li>Auth: signs with auth private key, encrypts payload with services' public key
 *        (hybrid: AES payload + RSA-wrapped key). Issues opaque token string.
 *   <li>Services: verify signature with auth public key, decrypt with services' private key.
 * </ul>
 */
public final class OpaqueTokenCrypto {

    private static final String RSA_TRANSFORMATION = "RSA/ECB/OAEPWithSHA-256AndMGF1Padding";
    private static final String AES_TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int GCM_IV_LENGTH = 12;
    private static final int GCM_TAG_LENGTH_BITS = 128;
    private static final int AES_KEY_SIZE_BITS = 256;
    private static final String SIGNATURE_ALGORITHM = "SHA256withRSA";

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private OpaqueTokenCrypto() {
    }

    /**
     * Issues an opaque token. Auth service uses this with its private key and the
     * services' public key. Payload is encrypted so only services can decrypt.
     *
     * @param authPrivateKey   auth service's private key (for signing)
     * @param servicesPublicKey services' public key (for encrypting payload key)
     * @param subject          subject (e.g. user id)
     * @param username         username
     * @param permissions      list of permission strings
     * @param ttlMs            token validity in milliseconds
     * @param timeService      time source for iat/exp
     * @return opaque token string (opaque to clients)
     */
    public static String issue(
            PrivateKey authPrivateKey,
            PublicKey servicesPublicKey,
            String subject,
            String username,
            List<String> permissions,
            long ttlMs,
            TimeService timeService) {
        long now = timeService.currentTimeMillis();
        OpaqueTokenPayload payload = new OpaqueTokenPayload(
                subject, username, permissions, now, now + ttlMs);
        return issue(authPrivateKey, servicesPublicKey, payload);
    }

    /**
     * Issues an opaque token from a pre-built payload (e.g. with custom iat/exp).
     */
    public static String issue(
            PrivateKey authPrivateKey,
            PublicKey servicesPublicKey,
            OpaqueTokenPayload payload) {
        try {
            byte[] payloadJson = MAPPER.writeValueAsBytes(payload);
            byte[] iv = new byte[GCM_IV_LENGTH];
            SecureRandomHolder.nextBytes(iv);

            SecretKey aesKey = generateAesKey();
            byte[] encryptedPayload = encryptAesGcm(aesKey, iv, payloadJson);
            byte[] encryptedAesKey = encryptRsaOaep(servicesPublicKey, aesKey.getEncoded());

            byte[] ivAndCipher = ByteBuffer.allocate(iv.length + encryptedPayload.length).put(iv).put(encryptedPayload).array();
            byte[] blob = ByteBuffer.allocate(encryptedAesKey.length + ivAndCipher.length)
                    .put(encryptedAesKey)
                    .put(ivAndCipher)
                    .array();
            byte[] signature = sign(authPrivateKey, blob);

            return base64Url(signature) + "." + base64Url(encryptedAesKey) + "." + base64Url(ivAndCipher);
        } catch (Exception e) {
            throw new SecurityException("Failed to issue opaque token", e);
        }
    }

    /**
     * Verifies and decrypts an opaque token. Backend services use this with
     * auth's public key and their own private key. Throws if token is invalid
     * or expired.
     *
     * @param token              opaque token string
     * @param authPublicKey      auth service's public key (for signature verification)
     * @param servicesPrivateKey services' private key (for decryption)
     * @param timeService        time source for expiry check
     * @return decrypted payload
     * @throws SecurityException if token is invalid, tampered, or expired
     */
    public static OpaqueTokenPayload verifyAndDecrypt(
            String token,
            PublicKey authPublicKey,
            PrivateKey servicesPrivateKey,
            TimeService timeService) {
        try {
            String[] parts = token.split("\\.");
            if (parts.length != 3) {
                throw new SecurityException("Invalid token format");
            }
            byte[] signature = base64UrlDecode(parts[0]);
            byte[] encryptedAesKey = base64UrlDecode(parts[1]);
            byte[] ivAndCipher = base64UrlDecode(parts[2]);
            if (ivAndCipher.length < GCM_IV_LENGTH) {
                throw new SecurityException("Invalid token ciphertext");
            }
            ByteBuffer buf = ByteBuffer.wrap(ivAndCipher);
            byte[] iv = new byte[GCM_IV_LENGTH];
            buf.get(iv);
            byte[] ciphertext = new byte[buf.remaining()];
            buf.get(ciphertext);

            byte[] blob = ByteBuffer.allocate(encryptedAesKey.length + ivAndCipher.length)
                    .put(encryptedAesKey)
                    .put(ivAndCipher)
                    .array();
            if (!verify(authPublicKey, blob, signature)) {
                throw new SecurityException("Invalid token signature");
            }

            byte[] aesKeyBytes = decryptRsaOaep(servicesPrivateKey, encryptedAesKey);
            SecretKey aesKey = new SecretKeySpec(aesKeyBytes, "AES");
            byte[] payloadJson = decryptAesGcm(aesKey, iv, ciphertext);

            OpaqueTokenPayload payload = MAPPER.readValue(payloadJson, OpaqueTokenPayload.class);
            long now = timeService.currentTimeMillis();
            if (now > payload.getExpiresAtMs()) {
                throw new SecurityException("Token expired");
            }
            return payload;
        } catch (JsonProcessingException e) {
            throw new SecurityException("Invalid token payload", e);
        } catch (Exception e) {
            if (e instanceof SecurityException) {
                throw (SecurityException) e;
            }
            throw new SecurityException("Failed to verify/decrypt token", e);
        }
    }

    /**
     * Generates a new RSA key pair (e.g. for auth or for services). Use 2048 or 4096 bits.
     */
    public static KeyPair generateRsaKeyPair(int keySizeBits) {
        try {
            KeyPairGenerator gen = KeyPairGenerator.getInstance("RSA");
            gen.initialize(keySizeBits);
            return gen.generateKeyPair();
        } catch (Exception e) {
            throw new SecurityException("Failed to generate RSA key pair", e);
        }
    }

    private static SecretKey generateAesKey() {
        try {
            KeyGenerator gen = KeyGenerator.getInstance("AES");
            gen.init(AES_KEY_SIZE_BITS);
            return gen.generateKey();
        } catch (Exception e) {
            throw new SecurityException("Failed to generate AES key", e);
        }
    }

    private static byte[] encryptAesGcm(SecretKey key, byte[] iv, byte[] plaintext) {
        try {
            Cipher cipher = Cipher.getInstance(AES_TRANSFORMATION);
            AlgorithmParameterSpec spec = new GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv);
            cipher.init(Cipher.ENCRYPT_MODE, key, spec);
            return cipher.doFinal(plaintext);
        } catch (Exception e) {
            throw new SecurityException("AES-GCM encryption failed", e);
        }
    }

    private static byte[] decryptAesGcm(SecretKey key, byte[] iv, byte[] ciphertext) {
        try {
            Cipher cipher = Cipher.getInstance(AES_TRANSFORMATION);
            AlgorithmParameterSpec spec = new GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv);
            cipher.init(Cipher.DECRYPT_MODE, key, spec);
            return cipher.doFinal(ciphertext);
        } catch (Exception e) {
            throw new SecurityException("AES-GCM decryption failed", e);
        }
    }

    private static byte[] encryptRsaOaep(PublicKey publicKey, byte[] plaintext) {
        try {
            Cipher cipher = Cipher.getInstance(RSA_TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, publicKey);
            return cipher.doFinal(plaintext);
        } catch (Exception e) {
            throw new SecurityException("RSA encryption failed", e);
        }
    }

    private static byte[] decryptRsaOaep(PrivateKey privateKey, byte[] ciphertext) {
        try {
            Cipher cipher = Cipher.getInstance(RSA_TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, privateKey);
            return cipher.doFinal(ciphertext);
        } catch (Exception e) {
            throw new SecurityException("RSA decryption failed", e);
        }
    }

    private static byte[] sign(PrivateKey privateKey, byte[] data) {
        try {
            Signature sig = Signature.getInstance(SIGNATURE_ALGORITHM);
            sig.initSign(privateKey);
            sig.update(data);
            return sig.sign();
        } catch (Exception e) {
            throw new SecurityException("Signing failed", e);
        }
    }

    private static boolean verify(PublicKey publicKey, byte[] data, byte[] signature) {
        try {
            Signature sig = Signature.getInstance(SIGNATURE_ALGORITHM);
            sig.initVerify(publicKey);
            sig.update(data);
            return sig.verify(signature);
        } catch (Exception e) {
            return false;
        }
    }

    private static String base64Url(byte[] data) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(data);
    }

    private static byte[] base64UrlDecode(String s) {
        return Base64.getUrlDecoder().decode(s);
    }

    private static final class SecureRandomHolder {
        private static final java.security.SecureRandom RAND = new java.security.SecureRandom();

        static void nextBytes(byte[] bytes) {
            RAND.nextBytes(bytes);
        }
    }
}
