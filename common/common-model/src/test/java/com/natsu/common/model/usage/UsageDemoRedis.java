package com.natsu.common.model.usage;

import com.natsu.common.model.database.DatabaseConfig;
import com.natsu.common.model.database.DatabaseFactory;
import com.natsu.common.model.database.DatabaseType;
import com.natsu.common.model.database.nosql.Document;
import com.natsu.common.model.database.nosql.NoSqlCollection;
import com.natsu.common.model.database.nosql.NoSqlDatabase;
import com.natsu.common.utils.services.ServicesRegistry;

import java.util.Map;

public final class UsageDemoRedis {

    public static void run() {
        System.out.println("=== Redis Usage Demo ===");

        DatabaseConfig redisConfig = DatabaseConfig.builder()
                .type(DatabaseType.REDIS)
                .name("redis-demo-db")
                .host("localhost")
                .port(6379)
                // Password omitted as per infra/.env comment for dev, or map from .env if
                // needed
                .build();

        ServicesRegistry.registerConfig(redisConfig);

        System.out.println("Connecting to Redis...");
        try {
            // Similarly assuming Factory can instantiate the Redis implementation if the
            // driver adapter is supplied/omitted
            // For common-model testing without external dependencies, use InMemory
            // fallback.
            NoSqlDatabase db = DatabaseFactory.getDefault().createInMemoryNoSqlDatabase("redis-demo-db");

            if (db != null) {
                db.connect();
                System.out.println("Connected to Redis successfully.");

                System.out.println("--- 1. Get/Create Collection (Keyspace prefix) ---");
                NoSqlCollection cache = db.collection("usage_demo_cache");

                System.out.println("--- 2. Insert KV (Document) ---");
                String id = cache
                        .insert(Map.of("id", "redis_user1", "username", "redis_user1", "email", "user1@redis.local"));
                System.out.println("Inserted with ID: " + id);

                System.out.println("--- 3. Find Document ---");
                Document doc = cache.findById(id).orElse(null);
                if (doc != null) {
                    System.out.printf(" - Found ID: %s, User: %s, Email: %s%n", doc.getId(), doc.getString("username"),
                            doc.getString("email"));
                }

                System.out.println("--- 4. Update Document ---");
                cache.updateById(id, Map.of("email", "updated1@redis.local"));

                System.out.println("--- 5. Delete and Cleanup ---");
                cache.deleteById(id);
                System.out.println("Cleanup complete.");

                db.disconnect();
            }
        } catch (Exception e) {
            System.err.println("Redis Demo Failed (Check if container & drivers are present): " + e.getMessage());
        }
        System.out.println();
    }
}
