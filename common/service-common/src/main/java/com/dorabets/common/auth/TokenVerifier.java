package com.dorabets.common.auth;

import java.util.List;
import java.util.Map;

/**
 * Verifies opaque Dorabets tokens and extracts claims.
 * In production this delegates to the Token Verification Sidecar via HTTP.
 * For local dev, a simplified in-process verifier can be used.
 */
public interface TokenVerifier {

    TokenClaims verify(String opaqueToken);

    record TokenClaims(
            String userId,
            String sessionId,
            List<String> roles,
            List<String> permissions,
            String deviceId,
            String tenantId,
            int policyVersion,
            long expiresAt
    ) {
        public boolean hasPermission(String required) {
            if (permissions == null) return false;
            for (String p : permissions) {
                if (p.equals(required) || p.endsWith(".*") && required.startsWith(p.substring(0, p.length() - 1))) {
                    return true;
                }
            }
            return false;
        }

        public boolean hasRole(String role) {
            return roles != null && roles.contains(role);
        }
    }
}
