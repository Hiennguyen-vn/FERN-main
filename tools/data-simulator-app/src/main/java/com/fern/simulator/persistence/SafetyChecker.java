package com.fern.simulator.persistence;

import java.util.Set;

/**
 * Guards against accidentally running the simulator against a non-local database.
 */
public final class SafetyChecker {

    private static final Set<String> LOCAL_HOSTS = Set.of(
            "localhost", "127.0.0.1", "0.0.0.0", "::1"
    );

    private SafetyChecker() {
    }

    /**
     * Throws if the database target is not a localhost address.
     */
    public static void requireLocalhost(DatabaseTarget target) {
        String host = target.hostname().toLowerCase();
        if (!LOCAL_HOSTS.contains(host)) {
            throw new IllegalStateException(
                    "Refusing to run simulator against non-local database: " + host +
                    ". Use --allow-non-local to override this safety check.");
        }
    }
}
