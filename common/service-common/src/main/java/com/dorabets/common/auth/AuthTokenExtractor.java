package com.dorabets.common.auth;

/**
 * Utility for extracting authentication tokens from HTTP headers.
 * Supports Bearer tokens and opaque session cookies.
 */
public final class AuthTokenExtractor {

    private AuthTokenExtractor() {
    }

    public static String extractToken(String authorizationHeader, String cookieHeader, String cookieName) {
        String fromAuth = fromAuthorizationHeader(authorizationHeader);
        if (fromAuth != null && !fromAuth.isBlank()) {
            return fromAuth;
        }
        return fromCookieHeader(cookieHeader, cookieName);
    }

    public static String fromAuthorizationHeader(String authorizationHeader) {
        if (authorizationHeader == null) return null;
        if (!authorizationHeader.startsWith("Bearer ")) return null;
        String token = authorizationHeader.substring(7).trim();
        return token.isBlank() ? null : token;
    }

    public static String fromCookieHeader(String cookieHeader, String cookieName) {
        if (cookieHeader == null || cookieHeader.isBlank()) return null;
        if (cookieName == null || cookieName.isBlank()) return null;

        String[] pairs = cookieHeader.split(";");
        for (String pair : pairs) {
            String trimmed = pair.trim();
            if (trimmed.isEmpty()) continue;
            int idx = trimmed.indexOf('=');
            if (idx <= 0) continue;
            String name = trimmed.substring(0, idx).trim();
            if (!cookieName.equals(name)) continue;
            String value = trimmed.substring(idx + 1).trim();
            if (value.startsWith("\"") && value.endsWith("\"") && value.length() >= 2) {
                value = value.substring(1, value.length() - 1);
            }
            return value.isBlank() ? null : value;
        }
        return null;
    }
}
