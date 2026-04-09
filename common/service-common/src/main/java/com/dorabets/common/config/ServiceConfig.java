package com.dorabets.common.config;

/**
 * Unified configuration record for any Dorabets service.
 * Constructed from environment variables or config files.
 */
public record ServiceConfig(
        String serviceName,
        int port,
        // PostgreSQL
        String dbUrl,
        String dbUser,
        String dbPassword,
        int dbPoolSize,
        // Replica (read-only)
        String dbReplicaUrl,
        // Redis
        String redisHost,
        int redisPort,
        int redisPoolSize,
        // Kafka
        String kafkaBootstrap
) {
    /**
     * Load configuration from environment variables with sensible local-dev defaults.
     */
    public static ServiceConfig fromEnv(String serviceName, int defaultPort, String defaultDb) {
        return new ServiceConfig(
                serviceName,
                intEnv("PORT", defaultPort),
                env("DB_URL", "jdbc:postgresql://localhost:15432/" + defaultDb + "?sslmode=disable"),
                env("DB_USER", "dorabets"),
                env("DB_PASSWORD", "dorabets_local_dev"),
                intEnv("DB_POOL_SIZE", 10),
                env("DB_REPLICA_URL", "jdbc:postgresql://localhost:15433/" + defaultDb + "?sslmode=disable"),
                env("REDIS_HOST", "localhost"),
                intEnv("REDIS_PORT", 6380),
                intEnv("REDIS_POOL_SIZE", 8),
                env("KAFKA_BOOTSTRAP", "localhost:19092")
        );
    }

    private static String env(String key, String defaultValue) {
        String val = System.getenv(key);
        return (val != null && !val.isBlank()) ? val : defaultValue;
    }

    private static int intEnv(String key, int defaultValue) {
        String val = System.getenv(key);
        if (val != null && !val.isBlank()) {
            try { return Integer.parseInt(val); } catch (NumberFormatException ignored) {}
        }
        return defaultValue;
    }
}
