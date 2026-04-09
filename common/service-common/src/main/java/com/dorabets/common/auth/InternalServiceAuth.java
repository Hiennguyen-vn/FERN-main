package com.dorabets.common.auth;

import com.dorabets.common.middleware.ServiceException;
import io.javalin.http.Context;

import java.net.http.HttpRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Internal service authentication and trusted auth-context forwarding.
 */
public final class InternalServiceAuth {

    public static final String HEADER_SERVICE_NAME = "X-Internal-Service";
    public static final String HEADER_SERVICE_TOKEN = "X-Internal-Token";
    public static final String HEADER_USER_ID = "X-Internal-User-Id";
    public static final String HEADER_SESSION_ID = "X-Internal-Session-Id";
    public static final String HEADER_ROLES = "X-Internal-Roles";
    public static final String HEADER_PERMISSIONS = "X-Internal-Permissions";
    public static final String ATTR_SERVICE_NAME = "service_name";

    private final String sharedToken;
    private final Set<String> allowedServices;

    public InternalServiceAuth() {
        this(requireSharedToken(), parseCsv(System.getenv("INTERNAL_SERVICE_ALLOWLIST")));
    }

    public InternalServiceAuth(String sharedToken) {
        this(sharedToken, Set.of());
    }

    public InternalServiceAuth(String sharedToken, Set<String> allowedServices) {
        this.sharedToken = normalizeRequiredToken(sharedToken);
        this.allowedServices = allowedServices == null ? Set.of() : Set.copyOf(new LinkedHashSet<>(allowedServices));
    }

    public boolean isConfigured() {
        return sharedToken != null && !sharedToken.isBlank();
    }

    public void apply(HttpRequest.Builder builder, String serviceName) {
        if (!isConfigured()) {
            throw new IllegalStateException("INTERNAL_SERVICE_TOKEN is required for internal service requests");
        }
        builder.header(HEADER_SERVICE_NAME, serviceName);
        builder.header(HEADER_SERVICE_TOKEN, sharedToken);
    }

    public void apply(HttpRequest.Builder builder, String serviceName, TokenVerifier.TokenClaims claims) {
        apply(builder, serviceName);
        if (claims == null) {
            return;
        }
        if (claims.userId() != null && !claims.userId().isBlank()) {
            builder.header(HEADER_USER_ID, claims.userId());
        }
        if (claims.sessionId() != null && !claims.sessionId().isBlank()) {
            builder.header(HEADER_SESSION_ID, claims.sessionId());
        }
        if (claims.roles() != null && !claims.roles().isEmpty()) {
            builder.header(HEADER_ROLES, String.join(",", claims.roles()));
        }
        if (claims.permissions() != null && !claims.permissions().isEmpty()) {
            builder.header(HEADER_PERMISSIONS, String.join(",", claims.permissions()));
        }
    }

    public ServicePrincipal authenticate(Context ctx) {
        if (!hasInternalHeaders(ctx)) {
            return null;
        }

        String serviceName = trimToNull(ctx.header(HEADER_SERVICE_NAME));
        String token = trimToNull(ctx.header(HEADER_SERVICE_TOKEN));
        if (serviceName == null || token == null) {
            throw ServiceException.unauthorized("Invalid internal service authentication");
        }
        if (!isConfigured()) {
            throw ServiceException.unauthorized("Internal service authentication is not configured");
        }
        if (!allowedServices.isEmpty() && !allowedServices.contains(serviceName)) {
            throw ServiceException.forbidden("Service is not allowed: " + serviceName);
        }
        if (!MessageDigest.isEqual(
                sharedToken.getBytes(StandardCharsets.UTF_8),
                token.getBytes(StandardCharsets.UTF_8))) {
            throw ServiceException.unauthorized("Invalid internal service authentication");
        }

        String userId = trimToNull(ctx.header(HEADER_USER_ID));
        String sessionId = trimToNull(ctx.header(HEADER_SESSION_ID));
        if (userId != null) {
            validateUuid(userId, HEADER_USER_ID);
        }
        if (sessionId != null) {
            validateUuid(sessionId, HEADER_SESSION_ID);
        }

        List<String> roles = parseCsvList(ctx.header(HEADER_ROLES));
        List<String> permissions = parseCsvList(ctx.header(HEADER_PERMISSIONS));
        if (userId == null && roles.isEmpty()) {
            roles = List.of("service");
        }

        return new ServicePrincipal(serviceName, userId, sessionId, roles, permissions);
    }

    public static boolean hasInternalHeaders(Context ctx) {
        return trimToNull(ctx.header(HEADER_SERVICE_NAME)) != null
                || trimToNull(ctx.header(HEADER_SERVICE_TOKEN)) != null
                || trimToNull(ctx.header(HEADER_USER_ID)) != null
                || trimToNull(ctx.header(HEADER_SESSION_ID)) != null
                || trimToNull(ctx.header(HEADER_ROLES)) != null
                || trimToNull(ctx.header(HEADER_PERMISSIONS)) != null;
    }

    private static Set<String> parseCsv(String raw) {
        Set<String> values = new LinkedHashSet<>();
        for (String item : parseCsvList(raw)) {
            values.add(item);
        }
        return values;
    }

    private static List<String> parseCsvList(String raw) {
        List<String> values = new ArrayList<>();
        if (raw == null || raw.isBlank()) {
            return values;
        }
        for (String part : raw.split(",")) {
            String trimmed = trimToNull(part);
            if (trimmed != null) {
                values.add(trimmed);
            }
        }
        return values;
    }

    private static void validateUuid(String raw, String headerName) {
        try {
            java.util.UUID.fromString(raw);
        } catch (IllegalArgumentException e) {
            throw ServiceException.unauthorized("Invalid internal auth context: " + headerName);
        }
    }

    private static String requireSharedToken() {
        return normalizeRequiredToken(System.getenv("INTERNAL_SERVICE_TOKEN"));
    }

    static String resolveSharedToken(String configuredToken) {
        if (configuredToken != null && !configuredToken.isBlank()) {
            return configuredToken.trim();
        }
        return "";
    }

    private static String normalizeRequiredToken(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("INTERNAL_SERVICE_TOKEN must be configured");
        }
        return value.trim();
    }

    private static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    public record ServicePrincipal(
            String serviceName,
            String userId,
            String sessionId,
            List<String> roles,
            List<String> permissions
    ) {
        public TokenVerifier.TokenClaims toClaims() {
            return new TokenVerifier.TokenClaims(
                    userId,
                    sessionId != null ? sessionId : "internal:" + serviceName,
                    roles,
                    permissions,
                    "",
                    "default",
                    1,
                    Long.MAX_VALUE
            );
        }
    }
}
