package com.natsu.common.utils.usage;

import com.natsu.common.utils.security.HashUtil;
import com.natsu.common.utils.security.OpaqueTokenCrypto;
import com.natsu.common.utils.security.OpaqueTokenPayload;
import com.natsu.common.utils.security.PasswordUtil;
import com.natsu.common.utils.security.TokenUtil;
import com.natsu.common.utils.services.timing.TimeServiceImpl;

import java.security.KeyPair;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.util.List;

/**
 * Usage example for Security Utilities.
 */
public final class SecurityUsage {

    public static void main(String[] args) {
        System.out.println("=== Security Usage Example ===");

        try {
            demonstratePasswordUtil();
            demonstrateHashUtil();
            demonstrateOpaqueToken();
            demonstrateTokenUtil();
        } catch (Exception e) {
            System.err.println("Security Usage Example Failed: " + e.getMessage());
            e.printStackTrace();
        }

        System.out.println("\n=== Done ===");
    }

    private static void demonstratePasswordUtil() throws Exception {
        System.out.println("\n--- Password Util ---");
        String password = "SuperSecretPassword123!";

        // Hash password
        String hashedPassword = PasswordUtil.hash(password);
        System.out.println("Password: " + password);
        System.out.println("Hashed: " + hashedPassword);

        // Verify
        boolean valid = PasswordUtil.verifyPassword(password, hashedPassword);
        System.out.println("Valid: " + valid);
    }

    private static void demonstrateHashUtil() throws Exception {
        System.out.println("\n--- Hash Util ---");
        String input = "Hello World";

        String sha256 = HashUtil.sha256(input);
        System.out.println("Input: " + input);
        System.out.println("SHA-256: " + sha256);
    }

    private static void demonstrateOpaqueToken() {
        System.out.println("\n--- Opaque Asymmetric Token ---");
        try {
            // Auth service key (signs tokens); services key (receives encrypted payload)
            KeyPair authKeys = OpaqueTokenCrypto.generateRsaKeyPair(2048);
            KeyPair servicesKeys = OpaqueTokenCrypto.generateRsaKeyPair(2048);
            PrivateKey authPrivate = authKeys.getPrivate();
            PublicKey authPublic = authKeys.getPublic();
            PublicKey servicesPublic = servicesKeys.getPublic();
            PrivateKey servicesPrivate = servicesKeys.getPrivate();

            // Auth: issue token (opaque to client)
            long ttlMs = 3600_000L; // 1 hour
            String token = OpaqueTokenCrypto.issue(
                    authPrivate, servicesPublic,
                    "user123", "alice",
                    List.of("auth.login", "dashboard.view"),
                    ttlMs, new TimeServiceImpl());
            System.out.println("Issued token (opaque): " + token.substring(0, Math.min(60, token.length())) + "...");

            // Service: verify and decrypt
            OpaqueTokenPayload payload = OpaqueTokenCrypto.verifyAndDecrypt(
                    token, authPublic, servicesPrivate, new TimeServiceImpl());
            System.out.println("Decrypted subject: " + payload.getSubject());
            System.out.println("Decrypted username: " + payload.getUsername());
            System.out.println("Permissions: " + payload.getPermissions());
        } catch (Exception e) {
            System.err.println("Opaque token operation failed: " + e.getMessage());
            e.printStackTrace();
        }
    }

    private static void demonstrateTokenUtil() {
        System.out.println("\n--- Token Util ---");
        // Generate a random token string
        String randomToken = TokenUtil.generateRandomToken(32);
        System.out.println("Random Token: " + randomToken);
    }
}
