package com.natsu.common.utils.security;

import org.junit.jupiter.api.Test;

import java.io.File;
import java.io.FileWriter;
import java.nio.file.Files;
import java.security.NoSuchAlgorithmException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

public class HashUtilTest {
    @Test
    void testSha256String() throws Exception {
        String result = HashUtil.sha256("hello");
        assertNotNull(result);
        assertEquals(64, result.length()); // SHA-256 hex = 64 chars
    }

    @Test
    void testSha512String() throws Exception {
        String result = HashUtil.sha512("hello");
        assertNotNull(result);
        assertEquals(128, result.length()); // SHA-512 hex = 128 chars
    }

    @Test
    void testMd5String() throws Exception {
        String result = HashUtil.md5("hello");
        assertNotNull(result);
        assertEquals(32, result.length()); // MD5 hex = 32 chars
    }

    @Test
    void testSha256ByteArray() throws NoSuchAlgorithmException {
        byte[] data = "world".getBytes();
        String result = HashUtil.sha256(data);
        assertNotNull(result);
        assertEquals(64, result.length());
    }

    @Test
    void testSha256File() throws Exception {
        File temp = File.createTempFile("test", ".txt");
        try (FileWriter writer = new FileWriter(temp)) {
            writer.write("file content");
        }
        String result = HashUtil.sha256(temp);
        assertNotNull(result);
        assertEquals(64, result.length());
        Files.deleteIfExists(temp.toPath());
    }
}
