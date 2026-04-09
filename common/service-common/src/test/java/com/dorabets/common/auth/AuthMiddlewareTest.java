package com.dorabets.common.auth;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.dorabets.common.middleware.ServiceException;
import io.javalin.http.Context;
import io.javalin.http.HandlerType;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class AuthMiddlewareTest {

    private static final String INTERNAL_TOKEN = "test-internal-token-should-be-at-least-32";

    @Test
    void rejectsSpoofedLegacyUserHeaderWithoutToken() {
        AuthMiddleware middleware = middleware();

        Context ctx = mockContext("/v1/private", HandlerType.GET, Map.of(
                "X-User-Id", UUID.randomUUID().toString()
        ));

        ServiceException ex = assertThrows(ServiceException.class, () -> middleware.handle(ctx));

        assertEquals(401, ex.getStatusCode());
        assertEquals("unauthorized", ex.getErrorCode());
        assertEquals("Missing authentication token or session cookie", ex.getMessage());
    }

    @Test
    void rejectsMintedInternalRolesWithoutTrustedServiceToken() {
        AuthMiddleware middleware = middleware();

        Context ctx = mockContext("/v1/private", HandlerType.GET, Map.of(
                InternalServiceAuth.HEADER_SERVICE_NAME, "gateway-service",
                InternalServiceAuth.HEADER_USER_ID, UUID.randomUUID().toString(),
                InternalServiceAuth.HEADER_ROLES, "admin,superadmin"
        ));

        ServiceException ex = assertThrows(ServiceException.class, () -> middleware.handle(ctx));

        assertEquals(401, ex.getStatusCode());
        assertEquals("unauthorized", ex.getErrorCode());
        assertEquals("Invalid internal service authentication", ex.getMessage());
    }

    @Test
    void allowsDepositWebhookPathToReachControllerWithoutBearerToken() {
        AuthMiddleware middleware = middleware();

        Context ctx = mockContext("/v1/deposits/confirm", HandlerType.POST, Map.of());

        assertDoesNotThrow(() -> middleware.handle(ctx));
    }

    private Context mockContext(String path, HandlerType method, Map<String, String> headers) {
        Context ctx = mock(Context.class);
        Map<String, String> normalized = new HashMap<>();
        headers.forEach((key, value) -> normalized.put(key.toLowerCase(), value));
        when(ctx.path()).thenReturn(path);
        when(ctx.method()).thenReturn(method);
        when(ctx.header(org.mockito.ArgumentMatchers.anyString()))
                .thenAnswer(invocation -> normalized.get(invocation.getArgument(0, String.class).toLowerCase()));
        return ctx;
    }

    private AuthMiddleware middleware() {
        return new AuthMiddleware(
                token -> {
                    throw new AssertionError("Token verifier should not be invoked for this request");
                },
                "dorabets_session",
                new InternalServiceAuth(INTERNAL_TOKEN)
        );
    }
}
