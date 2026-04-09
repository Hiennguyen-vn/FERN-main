package com.natsu.common.model.usage;

/**
 * Usage example for Database features.
 * Demonstrates connecting and mapping basic queries against every DatabaseType
 * in the model layer.
 * 
 * Credentials correspond to the local dev environment configured in infra/.env
 */
public final class DatabaseUsage {

    public static void main(String[] args) {
        System.out.println("==================================================");
        System.out.println("GlobalScale ERP System - Detailed Database Usages");
        System.out.println("==================================================\n");

        // 1. Relational Databases (SQL)
        UsageDemoMySQL.run();
        UsageDemoPostgreSQL.run();

        // 2. Document/NoSQL Databases
        // Note: NoSql implementations natively require client adapters specific to
        // environments
        // The below demonstrations set configurations and attempt instantiation.
        UsageDemoMongoDB.run();
        UsageDemoRedis.run();

        System.out.println("==================================================");
        System.out.println("All Database Usage Demos Attempted.");
        System.out.println("==================================================");
    }
}
