package com.dorabets.common.auth;

import com.dorabets.common.middleware.ServiceException;
import io.javalin.http.Context;

import java.util.Set;
import java.util.UUID;

/**
 * Shared helpers for reading authenticated user and service context.
 */
public final class AuthContext {

    private static final Set<String> UNPRIVILEGED_PROXY_SERVICES = Set.of("gateway-service");

    private AuthContext() {
    }

    public static UUID requireUserId(Context ctx) {
        String raw = ctx.attribute("user_id");
        if (raw == null || raw.isBlank()) {
            throw ServiceException.forbidden("Authentication required");
        }
        try {
            return UUID.fromString(raw);
        } catch (IllegalArgumentException e) {
            throw ServiceException.badRequest("user_id must be a valid UUID");
        }
    }

    public static UUID userIdOrNull(Context ctx) {
        String raw = ctx.attribute("user_id");
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return UUID.fromString(raw);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    public static TokenVerifier.TokenClaims claims(Context ctx) {
        return ctx.attribute("claims");
    }

    public static String serviceName(Context ctx) {
        return ctx.attribute(InternalServiceAuth.ATTR_SERVICE_NAME);
    }

    public static boolean isService(Context ctx, String... allowedServices) {
        String serviceName = serviceName(ctx);
        if (serviceName == null || serviceName.isBlank()) {
            return false;
        }
        if (UNPRIVILEGED_PROXY_SERVICES.contains(serviceName)) {
            return false;
        }
        if (allowedServices == null || allowedServices.length == 0) {
            return true;
        }
        Set<String> allowed = Set.of(allowedServices);
        return allowed.contains(serviceName);
    }

    public static String requireService(Context ctx, String... allowedServices) {
        String serviceName = serviceName(ctx);
        if (!isService(ctx, allowedServices)) {
            throw ServiceException.forbidden("Service authentication required");
        }
        return serviceName;
    }

    public static boolean hasAnyRole(Context ctx, String... roles) {
        TokenVerifier.TokenClaims claims = claims(ctx);
        if (claims == null || roles == null) {
            return false;
        }
        for (String role : roles) {
            if (claims.hasRole(role)) {
                return true;
            }
        }
        return false;
    }

    public static void requireAdmin(Context ctx) {
        if (!hasAnyRole(ctx, "admin", "superadmin")) {
            throw ServiceException.forbidden("Admin access required");
        }
    }

    public static void requireAdminOrOperator(Context ctx) {
        if (!hasAnyRole(ctx, "admin", "superadmin", "operator")) {
            throw ServiceException.forbidden("Admin or operator access required");
        }
    }
}
