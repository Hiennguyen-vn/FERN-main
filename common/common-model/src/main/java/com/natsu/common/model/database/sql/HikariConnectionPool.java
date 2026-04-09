package com.natsu.common.model.database.sql;

import com.natsu.common.model.database.DatabaseException;

import java.lang.reflect.Method;
import java.sql.Connection;

/**
 * HikariCP-based connection pool.
 * Uses reflection to avoid compile-time dependency on HikariCP.
 * 
 * Add HikariCP to your dependencies:
 * implementation 'com.zaxxer:HikariCP:5.1.0'
 */
public class HikariConnectionPool implements ConnectionPool {

    private final Object hikariDataSource;
    private final Class<?> hikariDataSourceClass;

    private HikariConnectionPool(Object hikariDataSource, Class<?> hikariDataSourceClass) {
        this.hikariDataSource = hikariDataSource;
        this.hikariDataSourceClass = hikariDataSourceClass;
    }

    /**
     * Creates a HikariConnectionPool with the given configuration.
     *
     * @param config the configuration
     * @return the pool
     */
    public static HikariConnectionPool create(HikariConfig config) {
        try {
            Class<?> hikariConfigClass = Class.forName("com.zaxxer.hikari.HikariConfig");
            Class<?> hikariDataSourceClass = Class.forName("com.zaxxer.hikari.HikariDataSource");
            
            Object hikariConfig = hikariConfigClass.getDeclaredConstructor().newInstance();
            
            // Set configuration properties
            setProperty(hikariConfig, "setJdbcUrl", String.class, config.jdbcUrl);
            if (config.username != null) {
                setProperty(hikariConfig, "setUsername", String.class, config.username);
            }
            if (config.password != null) {
                setProperty(hikariConfig, "setPassword", String.class, config.password);
            }
            if (config.driverClassName != null) {
                setProperty(hikariConfig, "setDriverClassName", String.class, config.driverClassName);
            }
            
            setProperty(hikariConfig, "setMinimumIdle", int.class, config.minPoolSize);
            setProperty(hikariConfig, "setMaximumPoolSize", int.class, config.maxPoolSize);
            setProperty(hikariConfig, "setConnectionTimeout", long.class, config.connectionTimeoutMs);
            setProperty(hikariConfig, "setIdleTimeout", long.class, config.idleTimeoutMs);
            setProperty(hikariConfig, "setMaxLifetime", long.class, config.maxLifetimeMs);
            
            if (config.poolName != null) {
                setProperty(hikariConfig, "setPoolName", String.class, config.poolName);
            }
            if (config.connectionTestQuery != null) {
                setProperty(hikariConfig, "setConnectionTestQuery", String.class, config.connectionTestQuery);
            }
            
            setProperty(hikariConfig, "setAutoCommit", boolean.class, config.autoCommit);
            
            // Create data source
            Object dataSource = hikariDataSourceClass
                    .getDeclaredConstructor(hikariConfigClass)
                    .newInstance(hikariConfig);
            
            return new HikariConnectionPool(dataSource, hikariDataSourceClass);
            
        } catch (ClassNotFoundException e) {
            throw new DatabaseException("HikariCP not found. Add dependency: com.zaxxer:HikariCP:5.1.0", e);
        } catch (Exception e) {
            throw new DatabaseException("Failed to create HikariCP pool", e);
        }
    }

    @Override
    public Connection getConnection() {
        try {
            Method getConnection = hikariDataSourceClass.getMethod("getConnection");
            return (Connection) getConnection.invoke(hikariDataSource);
        } catch (Exception e) {
            throw new DatabaseException("Failed to get connection from HikariCP", e);
        }
    }

    @Override
    public void releaseConnection(Connection connection) {
        try {
            connection.close(); // HikariCP intercepts close() and returns to pool
        } catch (Exception e) {
            // Ignore
        }
    }

    @Override
    public int getActiveConnections() {
        return getHikariPoolMXBean("getActiveConnections");
    }

    @Override
    public int getIdleConnections() {
        return getHikariPoolMXBean("getIdleConnections");
    }

    @Override
    public int getTotalConnections() {
        return getHikariPoolMXBean("getTotalConnections");
    }

    @Override
    public int getMaxPoolSize() {
        try {
            Method getMaximumPoolSize = hikariDataSourceClass.getMethod("getMaximumPoolSize");
            return (int) getMaximumPoolSize.invoke(hikariDataSource);
        } catch (Exception e) {
            return -1;
        }
    }

    @Override
    public boolean isRunning() {
        try {
            Method isRunning = hikariDataSourceClass.getMethod("isRunning");
            return (boolean) isRunning.invoke(hikariDataSource);
        } catch (Exception e) {
            return false;
        }
    }

    @Override
    public void start() {
        // HikariCP starts automatically
    }

    @Override
    public void shutdown() {
        try {
            Method close = hikariDataSourceClass.getMethod("close");
            close.invoke(hikariDataSource);
        } catch (Exception e) {
            throw new DatabaseException("Failed to shutdown HikariCP", e);
        }
    }

    private int getHikariPoolMXBean(String methodName) {
        try {
            Method getHikariPoolMXBean = hikariDataSourceClass.getMethod("getHikariPoolMXBean");
            Object mxBean = getHikariPoolMXBean.invoke(hikariDataSource);
            if (mxBean != null) {
                Method method = mxBean.getClass().getMethod(methodName);
                return (int) method.invoke(mxBean);
            }
            return 0;
        } catch (Exception e) {
            return 0;
        }
    }

    private static void setProperty(Object obj, String methodName, Class<?> paramType, Object value) throws Exception {
        Method method = obj.getClass().getMethod(methodName, paramType);
        method.invoke(obj, value);
    }

    /**
     * Configuration for HikariCP.
     */
    public static class HikariConfig {
        String jdbcUrl;
        String username;
        String password;
        String driverClassName;
        String poolName;
        String connectionTestQuery;
        int minPoolSize = 5;
        int maxPoolSize = 20;
        long connectionTimeoutMs = 30000;
        long idleTimeoutMs = 600000;
        long maxLifetimeMs = 1800000;
        boolean autoCommit = true;

        public static HikariConfig create(String jdbcUrl) {
            HikariConfig config = new HikariConfig();
            config.jdbcUrl = jdbcUrl;
            return config;
        }

        public HikariConfig username(String username) {
            this.username = username;
            return this;
        }

        public HikariConfig password(String password) {
            this.password = password;
            return this;
        }

        public HikariConfig driverClassName(String driverClassName) {
            this.driverClassName = driverClassName;
            return this;
        }

        public HikariConfig poolName(String poolName) {
            this.poolName = poolName;
            return this;
        }

        public HikariConfig connectionTestQuery(String query) {
            this.connectionTestQuery = query;
            return this;
        }

        public HikariConfig minPoolSize(int minPoolSize) {
            this.minPoolSize = minPoolSize;
            return this;
        }

        public HikariConfig maxPoolSize(int maxPoolSize) {
            this.maxPoolSize = maxPoolSize;
            return this;
        }

        public HikariConfig connectionTimeoutMs(long connectionTimeoutMs) {
            this.connectionTimeoutMs = connectionTimeoutMs;
            return this;
        }

        public HikariConfig idleTimeoutMs(long idleTimeoutMs) {
            this.idleTimeoutMs = idleTimeoutMs;
            return this;
        }

        public HikariConfig maxLifetimeMs(long maxLifetimeMs) {
            this.maxLifetimeMs = maxLifetimeMs;
            return this;
        }

        public HikariConfig autoCommit(boolean autoCommit) {
            this.autoCommit = autoCommit;
            return this;
        }
    }
}
