package com.dorabets.common.auth;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class InternalServiceAuthTest {

    @AfterEach
    void tearDown() {
    }

    @Test
    void sharedTokenIsUnavailableWithoutExplicitConfiguration() {
        assertEquals("", InternalServiceAuth.resolveSharedToken(""));
    }

    @Test
    void configuredSharedTokenStillWins() {
        assertEquals("configured-token", InternalServiceAuth.resolveSharedToken("configured-token"));
    }
}
