package com.dorabets.common.security;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class FieldEncryptionTest {

    private static final String RAW_TEST_KEY = "dev-test-key-material-32-bytes!!!!";

    @Test
    void roundTripsPlaintext() {
        FieldEncryption encryption = FieldEncryption.fromKeyMaterial(RAW_TEST_KEY);

        String ciphertext = encryption.encrypt("super-secret-value");

        assertNotEquals("super-secret-value", ciphertext);
        assertEquals("super-secret-value", encryption.decrypt(ciphertext));
    }

    @Test
    void usesRandomIvForSamePlaintext() {
        FieldEncryption encryption = FieldEncryption.fromKeyMaterial(RAW_TEST_KEY);

        String first = encryption.encrypt("same-value");
        String second = encryption.encrypt("same-value");

        assertNotEquals(first, second);
        assertEquals("same-value", encryption.decrypt(first));
        assertEquals("same-value", encryption.decrypt(second));
    }

    @Test
    void rejectsTooShortKeyMaterial() {
        assertThrows(IllegalArgumentException.class,
                () -> FieldEncryption.fromKeyMaterial("short-key"));
    }
}
