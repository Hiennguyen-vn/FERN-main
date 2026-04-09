package com.dorabets.common.auth;

import com.dorabets.common.middleware.ServiceException;
import io.javalin.Javalin;
import io.javalin.http.Context;

import java.util.Set;
import java.util.regex.Pattern;

/**
 * Extracts and verifies opaque tokens from Authorization header.
 * Skips verification for health and public endpoints.
 */
public class AuthMiddleware {

    private static final String DEPOSIT_CONFIRM_WEBHOOK_PATH = "/v1/deposits/confirm";
    private static final Set<String> PUBLIC_PATHS = Set.of(
            "/health", "/health/live", "/health/ready",
            "/v1/auth/login", "/v1/auth/register", "/v1/auth/bootstrap-admin",
            "/v1/auth/forgot-password", "/v1/auth/reset-password", "/v1/auth/verify-email"
    );
    private static final Pattern CRASH_PUBLIC_READ_PATH = Pattern.compile(
            "^/v1/games/crash/rooms/[^/]+/(state|round/current|history|trendball/(snapshot|history|sections(?:/[^/]+(?:/players)?)?|active(?:/players)?|categories|board)|side-bets/configs)$"
    );
    private static final Pattern CHAT_PUBLIC_READ_PATH = Pattern.compile(
            "^/v1/chat/global/messages(?:/[^/]+)?$"
    );

    private final TokenVerifier tokenVerifier;
    private final String authCookieName;
    private final InternalServiceAuth internalServiceAuth;

    public AuthMiddleware(TokenVerifier tokenVerifier) {
        this(tokenVerifier, envOrDefault("AUTH_COOKIE_NAME", "dorabets_session"), new InternalServiceAuth());
    }

    AuthMiddleware(TokenVerifier tokenVerifier, String authCookieName, InternalServiceAuth internalServiceAuth) {
        this.tokenVerifier = tokenVerifier;
        this.authCookieName = authCookieName;
        this.internalServiceAuth = internalServiceAuth;
    }

    public void register(Javalin app) {
        app.before(this::handle);
    }

    void handle(Context ctx) {
        if (isPublicPath(ctx)) return;

        String token = AuthTokenExtractor.extractToken(
                ctx.header("Authorization"),
                ctx.header("Cookie"),
                authCookieName
        );
        InternalServiceAuth.ServicePrincipal internalPrincipal = internalServiceAuth.authenticate(ctx);
        if (internalPrincipal != null) {
            TokenVerifier.TokenClaims trustedClaims;
            if (internalPrincipal.userId() == null && token != null && !token.isBlank()) {
                trustedClaims = tokenVerifier.verify(token);
            } else {
                trustedClaims = internalPrincipal.toClaims();
            }
            ctx.attribute("claims", trustedClaims);
            ctx.attribute(InternalServiceAuth.ATTR_SERVICE_NAME, internalPrincipal.serviceName());
            if (trustedClaims.userId() != null && !trustedClaims.userId().isBlank()) {
                ctx.attribute("user_id", trustedClaims.userId());
            }
            if (trustedClaims.sessionId() != null && !trustedClaims.sessionId().isBlank()) {
                ctx.attribute("session_id", trustedClaims.sessionId());
            }
            if (token != null && !token.isBlank()) {
                ctx.attribute("auth_token", token);
            }
            return;
        }

        if (token == null || token.isBlank()) {
            throw ServiceException.unauthorized("Missing authentication token or session cookie");
        }
        TokenVerifier.TokenClaims claims = tokenVerifier.verify(token);
        ctx.attribute("claims", claims);
        ctx.attribute("user_id", claims.userId());
        ctx.attribute("auth_token", token);
        if (claims.sessionId() != null && !claims.sessionId().isBlank()) {
            ctx.attribute("session_id", claims.sessionId());
        }
    }

    private boolean isPublicPath(Context ctx) {
        String path = ctx.path();
        return PUBLIC_PATHS.contains(path)
                || ("POST".equalsIgnoreCase(ctx.method().name()) && DEPOSIT_CONFIRM_WEBHOOK_PATH.equals(path))
                || path.startsWith("/health")
                || CRASH_PUBLIC_READ_PATH.matcher(path).matches()
                || ("GET".equalsIgnoreCase(ctx.method().name()) && CHAT_PUBLIC_READ_PATH.matcher(path).matches());
    }

    private static String envOrDefault(String key, String def) {
        String value = System.getenv(key);
        return (value != null && !value.isBlank()) ? value : def;
    }
}
