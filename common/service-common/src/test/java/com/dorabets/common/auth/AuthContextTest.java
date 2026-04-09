package com.dorabets.common.auth;

import io.javalin.http.Context;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AuthContextTest {

    @Test
    void gatewayServiceIsNotTreatedAsPrivilegedInternalService() {
        Context ctx = mock(Context.class);
        when(ctx.attribute(InternalServiceAuth.ATTR_SERVICE_NAME)).thenReturn("gateway-service");

        assertFalse(AuthContext.isService(ctx));
        assertFalse(AuthContext.isService(ctx, "gateway-service"));
    }

    @Test
    void nonGatewayTrustedServicesStillPassServiceChecks() {
        Context ctx = mock(Context.class);
        when(ctx.attribute(InternalServiceAuth.ATTR_SERVICE_NAME)).thenReturn("betting-service");

        assertTrue(AuthContext.isService(ctx));
        assertTrue(AuthContext.isService(ctx, "betting-service", "crash-service"));
        assertFalse(AuthContext.isService(ctx, "wallet-service"));
    }
}
