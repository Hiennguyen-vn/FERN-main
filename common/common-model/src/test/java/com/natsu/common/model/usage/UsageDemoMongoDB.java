package com.natsu.common.model.usage;

import com.natsu.common.model.database.DatabaseConfig;
import com.natsu.common.model.database.DatabaseFactory;
import com.natsu.common.model.database.DatabaseType;
import com.natsu.common.model.database.nosql.Document;
import com.natsu.common.model.database.nosql.NoSqlCollection;
import com.natsu.common.model.database.nosql.NoSqlDatabase;
import com.natsu.common.utils.services.ServicesRegistry;

import java.util.Map;

public final class UsageDemoMongoDB {

    public static void run() {
        System.out.println("=== MongoDB Usage Demo ===");

        DatabaseConfig mongoConfig = DatabaseConfig.builder()
                .type(DatabaseType.MONGODB)
                .name("mongo-demo-db")
                .host("localhost")
                .port(27017)
                .username("admin")
                .password("password")
                .database("globalscale")
                .build();

        ServicesRegistry.registerConfig(mongoConfig);

        System.out.println("Connecting to MongoDB...");
        try {
            // For demonstration purposes, we utilize the InMemoryNoSqlDatabase fallback
            // because
            // actual MongoDatabase instances require drivers (MongoClientAdapter) which are
            // defined in external modules to keep common-model dependency-free.
            NoSqlDatabase db = DatabaseFactory.getDefault().createInMemoryNoSqlDatabase("mongo-demo-db");

            if (db != null) {
                db.connect();
                System.out.println("Connected to MongoDB successfully.");

                System.out.println("--- 1. Get/Create Collection ---");
                NoSqlCollection users = db.collection("usage_demo_users_mongo");

                System.out.println("--- 2. Insert Document ---");
                String id = users.insert(Map.of("username", "mongo_user1", "email", "user1@mongo.local"));
                System.out.println("Inserted with ID: " + id);

                System.out.println("--- 3. Find Document ---");
                Document doc = users.findById(id).orElse(null);
                if (doc != null) {
                    System.out.printf(" - Found ID: %s, User: %s, Email: %s%n", doc.getId(), doc.getString("username"),
                            doc.getString("email"));
                }

                System.out.println("--- 4. Update Document ---");
                users.updateById(id, Map.of("email", "updated1@mongo.local"));

                System.out.println("--- 5. Delete and Cleanup ---");
                users.deleteById(id);
                db.dropCollection("usage_demo_users_mongo");
                System.out.println("Cleanup complete.");

                db.disconnect();
            }
        } catch (Exception e) {
            System.err.println("MongoDB Demo Failed (Check if container & drivers are present): " + e.getMessage());
        }
        System.out.println();
    }
}
