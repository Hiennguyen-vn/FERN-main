package com.natsu.common.model.usage;

import com.natsu.common.model.database.DatabaseConfig;
import com.natsu.common.model.database.DatabaseFactory;
import com.natsu.common.model.database.DatabaseType;
import com.natsu.common.model.database.sql.SqlDatabase;
import com.natsu.common.utils.services.ServicesRegistry;

public final class UsageDemoMySQL {

    public static void run() {
        System.out.println("=== MySQL Usage Demo ===");

        DatabaseConfig mysqlConfig = DatabaseConfig.builder()
                .type(DatabaseType.MYSQL)
                .name("mysql-demo-db")
                .host("localhost")
                .port(3306)
                .database("globalscale")
                .username("admin")
                .password("password")
                .pooling(DatabaseConfig.PoolingConfig.builder()
                        .minSize(1)
                        .maxSize(5)
                        .build())
                .build();

        ServicesRegistry.registerConfig(mysqlConfig);

        System.out.println("Connecting to MySQL...");
        try {
            SqlDatabase db = DatabaseFactory.createSqlFromRegistry("mysql-demo-db");
            if (db != null) {
                db.connect();
                System.out.println("Connected to MySQL successfully.");

                System.out.println("--- 1. Create Table ---");
                db.execute("""
                            CREATE TABLE IF NOT EXISTS usage_demo_users_mysql (
                                id INT AUTO_INCREMENT PRIMARY KEY,
                                username VARCHAR(50) NOT NULL,
                                email VARCHAR(100)
                            )
                        """);

                System.out.println("--- 2. Insert Data ---");
                db.execute("INSERT INTO usage_demo_users_mysql (username, email) VALUES (?, ?)", "mysql_user1",
                        "user1@mysql.local");

                System.out.println("--- 3. Query Data ---");
                var results = db.query("SELECT * FROM usage_demo_users_mysql");
                for (var row : results) {
                    System.out.printf(" - ID: %d, User: %s, Email: %s%n", row.getInt("id"), row.getString("username"),
                            row.getString("email"));
                }

                System.out.println("--- 4. Update Data ---");
                db.execute("UPDATE usage_demo_users_mysql SET email = ? WHERE username = ?", "updated1@mysql.local",
                        "mysql_user1");

                System.out.println("--- 5. Delete and Cleanup ---");
                db.execute("DROP TABLE usage_demo_users_mysql");
                System.out.println("Cleanup complete.");

                db.disconnect();
            }
        } catch (Exception e) {
            System.err.println("MySQL Demo Failed (Check if container is running): " + e.getMessage());
        }
        System.out.println();
    }
}
