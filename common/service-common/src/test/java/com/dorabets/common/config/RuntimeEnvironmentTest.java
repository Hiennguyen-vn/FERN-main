package com.dorabets.common.config;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RuntimeEnvironmentTest {

    @AfterEach
    void tearDown() {
        RuntimeEnvironment.clearTestArguments();
    }

    @Test
    void runtimeModeDefaultsToStrictWithoutDevFlag() {
        RuntimeEnvironment.setTestArguments(List.of(), List.of());

        assertFalse(RuntimeEnvironment.isDevelopment());
        assertThrows(IllegalStateException.class,
                () -> RuntimeEnvironment.requireDevelopmentFor("test feature"));
    }

    @Test
    void runtimeModeEnablesDevelopmentFromApplicationArgs() {
        RuntimeEnvironment.setTestArguments(List.of(), List.of("--dev"));

        assertTrue(RuntimeEnvironment.isDevelopment());
    }

    @Test
    void runtimeModeEnablesDevelopmentFromInputArgs() {
        RuntimeEnvironment.setTestArguments(List.of("--dev"), List.of());

        assertTrue(RuntimeEnvironment.isDevelopment());
    }

    @Test
    void environmentVariablesAloneDoNotEnableDevelopmentMode() throws Exception {
        assertFalse(runProbe(false, "APP_ENV", "dev", "RUN_MODE", "dev", "TOKEN_VERIFY_MODE", "dev"));
    }

    @Test
    void explicitDevArgumentEnablesDevelopmentModeInRealProcess() throws Exception {
        assertTrue(runProbe(true, "APP_ENV", "prod"));
    }

    private boolean runProbe(boolean includeDevArg, String... envPairs) throws IOException, InterruptedException {
        String javaBinary = Path.of(System.getProperty("java.home"), "bin", "java").toString();
        ProcessBuilder builder = new ProcessBuilder(
                javaBinary,
                "-cp",
                System.getProperty("java.class.path"),
                "com.dorabets.common.config.RuntimeEnvironmentProbe"
        );
        if (includeDevArg) {
            builder.command().add("--dev");
        }
        builder.environment().clear();
        for (int i = 0; i + 1 < envPairs.length; i += 2) {
            builder.environment().put(envPairs[i], envPairs[i + 1]);
        }

        Process process = builder.start();
        int exitCode = process.waitFor();
        String stdout = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8).trim();
        String stderr = new String(process.getErrorStream().readAllBytes(), StandardCharsets.UTF_8).trim();
        if (exitCode != 0) {
            throw new AssertionError("Probe process failed: " + stderr);
        }
        return Boolean.parseBoolean(stdout);
    }
}
