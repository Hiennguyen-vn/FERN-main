package com.natsu.common.model.usage;

import com.natsu.common.model.database.DatabaseConfig;
import com.natsu.common.model.database.DatabaseFactory;
import com.natsu.common.model.database.DatabaseType;
import com.natsu.common.model.database.sql.SqlDatabase;
import com.natsu.common.utils.services.ServicesRegistry;

public final class UsageDemoPostgreSQL {

    public static void run() {
        System.out.println("=== PostgreSQL Usage Demo ===");

        DatabaseConfig postgresConfig = DatabaseConfig.builder()
                .type(DatabaseType.POSTGRESQL)
                .name("postgres-demo-db")
                .host("localhost")
                .port(5432)
                .database("globalscale")
                .username("admin")
                .password("password")
                .pooling(DatabaseConfig.PoolingConfig.builder()
                        .minSize(1)
                        .maxSize(5)
                        .build())
                .build();

        ServicesRegistry.registerConfig(postgresConfig);

        System.out.println("Connecting to PostgreSQL...");
        try {
            SqlDatabase db = DatabaseFactory.createSqlFromRegistry("postgres-demo-db");
            if (db != null) {
                db.connect();
                System.out.println("Connected to PostgreSQL successfully.");

                System.out.println("--- 1. Create Table ---");
                db.execute("""
                            CREATE TABLE IF NOT EXISTS usage_demo_users_pg (
                                id SERIAL PRIMARY KEY,
                                username VARCHAR(50) NOT NULL,
                                email VARCHAR(100)
                            )
                        """);

                System.out.println("--- 2. Insert Data ---");
                db.execute("INSERT INTO usage_demo_users_pg (username, email) VALUES (?, ?)", "pg_user1",
                        "user1@pg.local");

                System.out.println("--- 3. Query Data ---");
                var results = db.query("SELECT * FROM usage_demo_users_pg");
                for (var row : results) {
                    System.out.printf(" - ID: %d, User: %s, Email: %s%n", row.getInt("id"), row.getString("username"),
                            row.getString("email"));
                }

                System.out.println("--- 4. Update Data ---");
                db.execute("UPDATE usage_demo_users_pg SET email = ? WHERE username = ?", "updated1@pg.local",
                        "pg_user1");

                System.out.println("--- 5. Delete and Cleanup ---");
                db.execute("DROP TABLE usage_demo_users_pg");
                System.out.println("Cleanup complete.");

                db.disconnect();
            }
        } catch (Exception e) {
            System.err.println("PostgreSQL Demo Failed (Check if container is running): " + e.getMessage());
        }
        System.out.println();
    }
}
