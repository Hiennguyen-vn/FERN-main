package com.natsu.common.model.usage;

import com.natsu.common.model.cache.Cache;
import com.natsu.common.model.cache.CacheConfig;
import com.natsu.common.model.cache.CacheManager;
import com.natsu.common.utils.services.ServicesRegistry;

import java.time.Duration;

/**
 * Usage example for Cache features.
 * Demonstrates:
 * 1. Defining CacheConfig.
 * 2. Registering with ServicesRegistry.
 * 3. Using CacheManager to get/create caches.
 */
public final class CacheUsage {

    public static void main(String[] args) {
        System.out.println("=== Cache Usage Example ===");

        // 1. Create Cache Config (Default is In-Memory)
        // Builder requires name argument
        CacheConfig localCacheConfig = CacheConfig.builder("user-sessions")
                .maxSize(1000)
                .defaultTtl(Duration.ofMinutes(30))
                .build();

        // 2. Register Config
        System.out.println("Registering Cache Config: " + localCacheConfig.getName());
        ServicesRegistry.registerConfig(localCacheConfig);

        // 3. Retrieve and Use Cache
        try {
            // CacheManager uses the registry to find the config and create the cache
            Cache<String, String> sessionCache = CacheManager.getCacheFromRegistry("user-sessions");

            if (sessionCache != null) {
                System.out.println("Cache created: " + sessionCache.getName());

                // Put/Get
                sessionCache.put("session-123", "UserA");

                // Cache.get returns Optional
                String user = sessionCache.get("session-123").orElse("Unknown");
                System.out.println("Retrieved value: " + user);
            }
        } catch (Exception e) {
            System.err.println("Error using cache: " + e.getMessage());
        }

        // 4. Redis Cache Example (Configuration only)
        // Note: CacheConfig does not specify type directly; implementation depends on
        // CacheManager factory.
        // To use Redis, you would typically set the CacheManager factory or use a
        // specific Config subclass if available.
        // Here we just register a config intended for a different cache name.
        CacheConfig globalDataConfig = CacheConfig.builder("global-data")
                .maxSize(10000)
                .build();

        ServicesRegistry.registerConfig(globalDataConfig);

        System.out.println("Registered global-data config: " + globalDataConfig.getName());

        System.out.println("\n=== Done ===");
    }
}
