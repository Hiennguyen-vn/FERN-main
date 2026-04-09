package com.dorabets.common.config;

import java.lang.management.ManagementFactory;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * Shared runtime-mode helper for security-sensitive defaults.
 *
 * Development mode is enabled only when the current JVM process was started
 * with an explicit {@code --dev} argument, either as an application argument
 * or an input argument exposed by the launcher.
 */
public final class RuntimeEnvironment {

    public static final String DEV_FLAG = "--dev";

    private static volatile List<String> registeredAppArgs = List.of();
    private static volatile List<String> testInputArgs;
    private static volatile List<String> testAppArgs;

    private RuntimeEnvironment() {
    }

    public static void initialize(String[] appArgs) {
        registeredAppArgs = normalize(appArgs == null ? List.of() : Arrays.asList(appArgs));
    }

    public static boolean isDevelopment() {
        return containsDevFlag(currentInputArgs()) || containsDevFlag(currentAppArgs());
    }

    public static void requireDevelopmentFor(String featureName) {
        if (!isDevelopment()) {
            throw new IllegalStateException(featureName + " requires explicit " + DEV_FLAG + " startup");
        }
    }

    public static void setTestArguments(List<String> inputArgs, List<String> appArgs) {
        testInputArgs = normalize(inputArgs);
        testAppArgs = normalize(appArgs);
    }

    public static void clearTestArguments() {
        testInputArgs = null;
        testAppArgs = null;
        registeredAppArgs = List.of();
    }

    private static List<String> currentInputArgs() {
        if (testInputArgs != null) {
            return testInputArgs;
        }
        try {
            return normalize(ManagementFactory.getRuntimeMXBean().getInputArguments());
        } catch (Exception ignored) {
            return List.of();
        }
    }

    private static List<String> currentAppArgs() {
        if (testAppArgs != null) {
            return testAppArgs;
        }
        if (!registeredAppArgs.isEmpty()) {
            return registeredAppArgs;
        }
        return normalize(splitCommand(System.getProperty("sun.java.command", "")));
    }

    private static boolean containsDevFlag(List<String> args) {
        for (String arg : args) {
            if (DEV_FLAG.equals(arg)) {
                return true;
            }
        }
        return false;
    }

    private static List<String> normalize(List<String> values) {
        if (values == null || values.isEmpty()) {
            return List.of();
        }
        List<String> normalized = new ArrayList<>(values.size());
        for (String value : values) {
            if (value == null) {
                continue;
            }
            String trimmed = value.trim();
            if (!trimmed.isEmpty()) {
                normalized.add(trimmed);
            }
        }
        return Collections.unmodifiableList(normalized);
    }

    private static List<String> splitCommand(String raw) {
        if (raw == null || raw.isBlank()) {
            return List.of();
        }
        List<String> parts = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        boolean inQuotes = false;
        char quoteChar = 0;

        for (byte b : raw.getBytes(StandardCharsets.UTF_8)) {
            char ch = (char) b;
            if ((ch == '"' || ch == '\'') && (!inQuotes || ch == quoteChar)) {
                if (inQuotes) {
                    inQuotes = false;
                    quoteChar = 0;
                } else {
                    inQuotes = true;
                    quoteChar = ch;
                }
                continue;
            }
            if (Character.isWhitespace(ch) && !inQuotes) {
                if (current.length() > 0) {
                    parts.add(current.toString());
                    current.setLength(0);
                }
                continue;
            }
            current.append(ch);
        }

        if (current.length() > 0) {
            parts.add(current.toString());
        }
        return parts;
    }
}
