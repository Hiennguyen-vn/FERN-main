package com.dorabets.common.server;

import com.dorabets.common.config.ServiceConfig;
import com.dorabets.common.health.HealthController;
import com.dorabets.common.middleware.CorrelationMiddleware;
import com.dorabets.common.middleware.ErrorHandler;
import com.dorabets.idempotency.IdempotencyGuard;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import io.javalin.Javalin;
import io.javalin.json.JavalinJackson;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.common.serialization.StringSerializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import redis.clients.jedis.JedisPool;
import redis.clients.jedis.JedisPoolConfig;

import javax.sql.DataSource;
import java.util.Properties;

/**
 * Base application harness for every Dorabets service.
 * Subclasses override {@link #registerRoutes(Javalin)} to wire controllers.
 */
public abstract class ServiceApp {

    protected final Logger log = LoggerFactory.getLogger(getClass());
    protected final ServiceConfig config;
    protected final ObjectMapper objectMapper;
    protected final Javalin app;

    protected HikariDataSource dataSource;
    protected JedisPool redisPool;
    protected KafkaProducer<String, String> kafkaProducer;
    protected IdempotencyGuard idempotencyGuard;

    protected ServiceApp(ServiceConfig config) {
        this.config = config;
        this.objectMapper = createObjectMapper();
        this.app = createJavalin();
    }

    public void start() {
        log.info("Starting {} on port {}", config.serviceName(), config.port());
        try {
            log.info("Initializing datasource: {}", config.dbUrl());
            initDataSource();
            log.info("Datasource initialized");
            initRedis();
            log.info("Redis initialized");
            initKafka();
            log.info("Kafka initialized");
            initIdempotency();
            registerHealthRoutes();
            registerRoutes(app);
            app.start(config.port());
            log.info("{} started successfully", config.serviceName());
        } catch (Exception e) {
            log.error("Failed to start {}: {}", config.serviceName(), e.getMessage(), e);
            throw new RuntimeException("Service startup failed", e);
        }
    }

    public void stop() {
        log.info("Stopping {}", config.serviceName());
        app.stop();
        if (kafkaProducer != null) kafkaProducer.close();
        if (redisPool != null) redisPool.close();
        if (dataSource != null) dataSource.close();
    }

    protected abstract void registerRoutes(Javalin app);

    // ── Factory methods (overridable for testing) ──

    protected ObjectMapper createObjectMapper() {
        ObjectMapper om = new ObjectMapper();
        om.registerModule(new JavaTimeModule());
        om.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        om.disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
        return om;
    }

    protected Javalin createJavalin() {
        return Javalin.create(cfg -> {
            cfg.jsonMapper(new JavalinJackson(objectMapper, false));
            cfg.showJavalinBanner = false;
        });
    }

    protected void initDataSource() {
        if (config.dbUrl() == null) return;
        HikariConfig hc = new HikariConfig();
        hc.setJdbcUrl(config.dbUrl());
        hc.setUsername(config.dbUser());
        hc.setPassword(config.dbPassword());
        hc.setMaximumPoolSize(config.dbPoolSize());
        hc.setMinimumIdle(2);
        hc.setConnectionTimeout(5000);
        hc.setPoolName(config.serviceName() + "-pool");
        dataSource = new HikariDataSource(hc);
    }

    protected void initRedis() {
        if (config.redisHost() == null) return;
        JedisPoolConfig jpc = new JedisPoolConfig();
        jpc.setMaxTotal(config.redisPoolSize());
        jpc.setMaxIdle(config.redisPoolSize());
        jpc.setMinIdle(2);
        redisPool = new JedisPool(jpc, config.redisHost(), config.redisPort());
    }

    protected void initKafka() {
        if (config.kafkaBootstrap() == null) return;
        Properties props = new Properties();
        props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, config.kafkaBootstrap());
        props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());
        props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());
        props.put(ProducerConfig.ACKS_CONFIG, "all");
        props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, false);
        props.put(ProducerConfig.CLIENT_ID_CONFIG, config.serviceName());
        props.put(ProducerConfig.MAX_BLOCK_MS_CONFIG, 5000);
        kafkaProducer = new KafkaProducer<>(props);
    }

    protected void initIdempotency() {
        if (redisPool != null && dataSource != null) {
            idempotencyGuard = new IdempotencyGuard(redisPool, dataSource);
        }
    }

    private void registerHealthRoutes() {
        new HealthController(config.serviceName(), dataSource, redisPool).register(app);
        CorrelationMiddleware.register(app);
        ErrorHandler.register(app, objectMapper);
    }

    public DataSource getDataSource() { return dataSource; }
    public JedisPool getRedisPool() { return redisPool; }
    public KafkaProducer<String, String> getKafkaProducer() { return kafkaProducer; }
    public IdempotencyGuard getIdempotencyGuard() { return idempotencyGuard; }
    public ObjectMapper getObjectMapper() { return objectMapper; }
}
