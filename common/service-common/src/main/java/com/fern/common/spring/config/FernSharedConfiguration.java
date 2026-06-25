package com.fern.common.spring.config;

import com.fern.common.event.EventPublisher;
import com.fern.common.outbox.OutboxDlqForwarder;
import com.fern.common.outbox.OutboxRelay;
import com.fern.common.outbox.OutboxWriter;
import com.fern.common.outbox.OutboxWriter.IdGenerator;
import com.fern.common.sync.CentralSyncOutboxWriter;
import com.fern.common.sync.LocalSyncOutboxWriter;
import com.fern.common.idempotency.IdempotencyGuard;
import com.fern.common.spring.auth.JwtTokenService;
import com.fern.common.spring.auth.DeviceTokenRegistry;
import com.fern.common.spring.auth.SpringInternalServiceAuth;
import com.fern.common.spring.cache.JacksonCacheSerializer;
import com.fern.common.spring.cache.JedisRedisClientAdapter;
import com.fern.common.spring.events.TypedKafkaEventPublisher;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import io.micrometer.core.instrument.MeterRegistry;
import com.fern.common.model.cache.RedisClientAdapter;
import com.fern.common.utils.services.id.SnowflakeIdGenerator;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.time.Clock;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import javax.sql.DataSource;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.common.serialization.StringSerializer;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.kafka.annotation.EnableKafka;
import org.springframework.kafka.config.ConcurrentKafkaListenerContainerFactory;
import org.springframework.kafka.core.ConsumerFactory;
import org.springframework.kafka.core.DefaultKafkaConsumerFactory;
import org.springframework.kafka.core.DefaultKafkaProducerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.core.ProducerFactory;
import org.springframework.web.client.RestClient;
import org.postgresql.ds.PGSimpleDataSource;
import redis.clients.jedis.Jedis;
import redis.clients.jedis.JedisPool;
import redis.clients.jedis.JedisPoolConfig;
import redis.clients.jedis.JedisSentinelPool;
import redis.clients.jedis.util.Pool;

@Configuration
@EnableKafka
@EnableConfigurationProperties(FernServiceProperties.class)
public class FernSharedConfiguration {

  @Bean
  @ConditionalOnMissingBean
  public Clock clock() {
    return Clock.systemUTC();
  }

  @Bean
  @ConditionalOnMissingBean
  public ObjectMapper objectMapper() {
    ObjectMapper mapper = new ObjectMapper();
    mapper.registerModule(new JavaTimeModule());
    mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
    return mapper;
  }

  @Bean
  @ConditionalOnMissingBean
  public DataSource dataSource(FernServiceProperties properties) {
    return buildDataSource(
        properties.getPostgres().getUrl(),
        properties.getPostgres().getUsername(),
        properties.getPostgres().getPassword(),
        properties.getPostgres().getPoolSize(),
        properties.getPostgres().getSchema(),
        "fern-hikari-primary",
        false
    );
  }

  @Bean(name = "replicaDataSource")
  @ConditionalOnProperty(prefix = "dependencies.postgres", name = "replica-url")
  public DataSource replicaDataSource(FernServiceProperties properties) {
    String replicaUrl = properties.getPostgres().getReplicaUrl();
    if (replicaUrl == null || replicaUrl.isBlank()) {
      replicaUrl = properties.getPostgres().getUrl();
    }
    return buildDataSource(
        replicaUrl,
        properties.getPostgres().getUsername(),
        properties.getPostgres().getPassword(),
        properties.getPostgres().getPoolSize(),
        properties.getPostgres().getSchema(),
        "fern-hikari-replica",
        true
    );
  }

  @Bean
  @ConditionalOnMissingBean
  public Pool<Jedis> jedisPool(FernServiceProperties properties) {
    JedisPoolConfig config = new JedisPoolConfig();
    config.setMaxTotal(32);
    config.setMaxIdle(16);
    config.setMinIdle(2);
    FernServiceProperties.Redis redis = properties.getRedis();
    String password = (redis.getPassword() != null && !redis.getPassword().isBlank())
        ? redis.getPassword()
        : null;
    String sentinelMaster = redis.getSentinelMaster();
    String sentinelNodes = redis.getSentinelNodes();
    if (sentinelMaster != null && !sentinelMaster.isBlank()
        && sentinelNodes != null && !sentinelNodes.isBlank()) {
      Set<String> nodes = new HashSet<>();
      for (String node : sentinelNodes.split(",")) {
        String trimmed = node.trim();
        if (!trimmed.isEmpty()) {
          nodes.add(trimmed);
        }
      }
      if (password != null) {
        return new JedisSentinelPool(sentinelMaster, nodes, config,
            redis.getTimeoutMillis(), password);
      }
      return new JedisSentinelPool(sentinelMaster, nodes, config,
          redis.getTimeoutMillis());
    }
    if (password != null) {
      return new JedisPool(config, redis.getHost(), redis.getPort(), redis.getTimeoutMillis(), password);
    }
    return new JedisPool(config, redis.getHost(), redis.getPort(), redis.getTimeoutMillis());
  }

  @Bean
  @ConditionalOnMissingBean
  public RedisClientAdapter redisClientAdapter(Pool<Jedis> jedisPool) {
    return new JedisRedisClientAdapter(jedisPool);
  }

  @Bean
  @ConditionalOnMissingBean
  public IdempotencyGuard idempotencyGuard(Pool<Jedis> jedisPool, DataSource dataSource) {
    return new IdempotencyGuard(jedisPool, dataSource);
  }

  @Bean
  @ConditionalOnMissingBean
  public SnowflakeIdGenerator snowflakeIdGenerator(
      @Value("${WORKER_ID:1}") long workerId
  ) {
    return new SnowflakeIdGenerator(workerId);
  }

  @Bean
  @ConditionalOnMissingBean
  public IdGenerator outboxIdGenerator(SnowflakeIdGenerator snowflakeIdGenerator) {
    return snowflakeIdGenerator::generateId;
  }

  @Bean
  @ConditionalOnMissingBean
  public OutboxWriter outboxWriter(ObjectMapper objectMapper, IdGenerator outboxIdGenerator) {
    return new OutboxWriter(objectMapper, outboxIdGenerator);
  }

  @Bean
  @ConditionalOnMissingBean
  public CentralSyncOutboxWriter centralSyncOutboxWriter(ObjectMapper objectMapper) {
    return new CentralSyncOutboxWriter(objectMapper);
  }

  @Bean
  @ConditionalOnMissingBean
  public LocalSyncOutboxWriter localSyncOutboxWriter(
      ObjectMapper objectMapper,
      @Value("${sync.local-outbox.enabled:false}") boolean enabled
  ) {
    return new LocalSyncOutboxWriter(objectMapper, enabled);
  }

  @Bean
  @ConditionalOnMissingBean
  public OutboxRelay outboxRelay(
      javax.sql.DataSource dataSource,
      TypedKafkaEventPublisher typedKafkaEventPublisher,
      ObjectMapper objectMapper,
      ObjectProvider<MeterRegistry> meterRegistryProvider,
      @Value("${outbox.batch-limit:25}") int batchLimit,
      @Value("${outbox.max-attempts:10}") int maxAttempts,
      @Value("${outbox.reclaim-seconds:300}") int reclaimSeconds,
      @Value("${spring.application.name:unknown-service}") String applicationName
  ) {
    return new OutboxRelay(
        dataSource,
        typedKafkaEventPublisher,
        objectMapper,
        java.util.Optional.ofNullable(meterRegistryProvider.getIfAvailable()),
        batchLimit,
        maxAttempts,
        reclaimSeconds,
        applicationName
    );
  }

  @Bean
  @ConditionalOnMissingBean
  public OutboxDlqForwarder outboxDlqForwarder(
      javax.sql.DataSource dataSource,
      TypedKafkaEventPublisher typedKafkaEventPublisher,
      ObjectProvider<MeterRegistry> meterRegistryProvider,
      @Value("${outbox.dlq.topic:fern.outbox.dlq}") String outboxDlqTopic
  ) {
    return new OutboxDlqForwarder(
        dataSource,
        typedKafkaEventPublisher,
        outboxDlqTopic,
        java.util.Optional.ofNullable(meterRegistryProvider.getIfAvailable())
    );
  }

  @Bean(destroyMethod = "close")
  @ConditionalOnMissingBean
  public KafkaProducer<String, String> kafkaProducer(
      FernServiceProperties properties,
      @Value("${spring.application.name:unknown-service}") String serviceName
  ) {
    Map<String, Object> config = Map.of(
        ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, properties.getKafka().getBootstrap(),
        ProducerConfig.CLIENT_ID_CONFIG, properties.getKafka().getClientIdPrefix() + "-" + serviceName,
        ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class,
        ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class,
        ProducerConfig.ACKS_CONFIG, "all",
        ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true
    );
    return new KafkaProducer<>(config);
  }

  @Bean
  @ConditionalOnMissingBean
  public ConsumerFactory<String, String> consumerFactory(
      FernServiceProperties properties,
      @Value("${spring.application.name:unknown-service}") String serviceName,
      @Value("${dependencies.kafka.maxPollRecords:${dependencies.kafka.max-poll-records:200}}") int maxPollRecords
  ) {
    Map<String, Object> config = Map.of(
        ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, properties.getKafka().getBootstrap(),
        ConsumerConfig.GROUP_ID_CONFIG, properties.getKafka().getConsumerGroupPrefix() + "." + serviceName + ".v1",
        ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class,
        ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class,
        ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest",
        ConsumerConfig.MAX_POLL_RECORDS_CONFIG, maxPollRecords
    );
    return new DefaultKafkaConsumerFactory<>(config);
  }

  @Bean(name = "kafkaListenerContainerFactory")
  @ConditionalOnMissingBean(name = "kafkaListenerContainerFactory")
  public ConcurrentKafkaListenerContainerFactory<String, String> kafkaListenerContainerFactory(
      ConsumerFactory<String, String> consumerFactory
  ) {
    ConcurrentKafkaListenerContainerFactory<String, String> factory =
        new ConcurrentKafkaListenerContainerFactory<>();
    factory.setConsumerFactory(consumerFactory);
    factory.setConcurrency(3);
    return factory;
  }

  @Bean
  @ConditionalOnMissingBean
  public ProducerFactory<String, String> producerFactory(
      FernServiceProperties properties,
      @Value("${spring.application.name:unknown-service}") String serviceName
  ) {
    Map<String, Object> config = Map.of(
        ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, properties.getKafka().getBootstrap(),
        ProducerConfig.CLIENT_ID_CONFIG, properties.getKafka().getClientIdPrefix() + "-tmpl-" + serviceName,
        ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class,
        ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class,
        ProducerConfig.ACKS_CONFIG, "all",
        ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true
    );
    return new DefaultKafkaProducerFactory<>(config);
  }

  @Bean
  @ConditionalOnMissingBean
  public KafkaTemplate<String, String> kafkaTemplate(ProducerFactory<String, String> producerFactory) {
    return new KafkaTemplate<>(producerFactory);
  }

  @Bean
  @ConditionalOnMissingBean
  public EventPublisher legacyEventPublisher(
      KafkaProducer<String, String> kafkaProducer,
      ObjectMapper objectMapper,
      @Value("${spring.application.name:unknown-service}") String serviceName
  ) {
    return new EventPublisher(kafkaProducer, objectMapper, serviceName);
  }

  @Bean
  @ConditionalOnMissingBean
  public TypedKafkaEventPublisher typedKafkaEventPublisher(
      KafkaProducer<String, String> kafkaProducer,
      ObjectMapper objectMapper,
      Clock clock,
      @Value("${spring.application.name:unknown-service}") String serviceName
  ) {
    return new TypedKafkaEventPublisher(kafkaProducer, objectMapper, clock, serviceName);
  }

  @Bean
  @ConditionalOnMissingBean
  public RestClient.Builder restClientBuilder() {
    JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory();
    factory.setReadTimeout(java.time.Duration.ofSeconds(2));
    return RestClient.builder().requestFactory(factory);
  }

  @Bean
  @ConditionalOnMissingBean
  public JwtTokenService jwtTokenService(
      ObjectMapper objectMapper,
      @Value("${jwt.algorithm:${JWT_ALGORITHM:HS256}}") String jwtAlgorithm,
      @Value("${jwt.secret:}") String jwtSecretFromConfig,
      @Value("${jwt.private-key-pem:${JWT_PRIVATE_KEY_PEM:}}") String privateKeyPem,
      @Value("${jwt.public-key-pem:${JWT_PUBLIC_KEY_PEM:}}") String publicKeyPem,
      @Value("${jwt.key-id:${JWT_KEY_ID:fern-rsa-1}}") String keyId,
      @Value("${jwt.issuer:${JWT_ISSUER:fern}}") String issuer,
      @Value("${jwt.audience:${JWT_AUDIENCE:fern-services}}") String audience
  ) {
    JwtTokenService.Algorithm alg = JwtTokenService.Algorithm.valueOf(jwtAlgorithm.trim().toUpperCase());
    String secret = (jwtSecretFromConfig != null && !jwtSecretFromConfig.isBlank())
        ? jwtSecretFromConfig
        : System.getenv("JWT_SECRET");
    byte[] secretBytes = (secret == null || secret.isBlank())
        ? null
        : secret.getBytes(java.nio.charset.StandardCharsets.UTF_8);
    java.security.interfaces.RSAPrivateKey priv = (privateKeyPem == null || privateKeyPem.isBlank())
        ? null : JwtTokenService.parseRsaPrivateKey(privateKeyPem);
    java.security.interfaces.RSAPublicKey pub = (publicKeyPem == null || publicKeyPem.isBlank())
        ? null : JwtTokenService.parseRsaPublicKey(publicKeyPem);
    return new JwtTokenService(alg, secretBytes, priv, pub, keyId, issuer, audience);
  }

  @Bean
  @ConditionalOnMissingBean
  public DeviceTokenRegistry deviceTokenRegistry(DataSource dataSource, Clock clock) {
    return new DeviceTokenRegistry(dataSource, clock);
  }

  @Bean
  @ConditionalOnMissingBean
  public SpringInternalServiceAuth springInternalServiceAuth(
      @Value("${internal.service.token:}") String internalServiceTokenFromConfig,
      @Value("${internal.service.allowlist:${INTERNAL_SERVICE_ALLOWLIST:}}") String internalServiceAllowlist
  ) {
    // Prefer Vault-bound `internal.service.token`. Fall back to INTERNAL_SERVICE_TOKEN so
    // local dev, tests, and explicit env-fallback mode do not require Vault.
    String token = (internalServiceTokenFromConfig != null && !internalServiceTokenFromConfig.isBlank())
        ? internalServiceTokenFromConfig
        : System.getenv("INTERNAL_SERVICE_TOKEN");
    return new SpringInternalServiceAuth(token, parseCsv(internalServiceAllowlist));
  }

  @Bean
  @ConditionalOnMissingBean
  public JacksonCacheSerializer<Object> genericJacksonCacheSerializer(ObjectMapper objectMapper) {
    return new JacksonCacheSerializer<>(objectMapper, Object.class);
  }

  private static HikariDataSource buildDataSource(
      String url,
      String username,
      String password,
      int poolSize,
      String schema,
      String poolName,
      boolean readOnly
  ) {
    HikariConfig config = new HikariConfig();
    DataSource directDataSource = dataSourceForUrl(url, username, password);
    if (directDataSource != null) {
      config.setDataSource(directDataSource);
    } else {
      config.setJdbcUrl(url);
      String driverClassName = jdbcDriverClassName(url);
      if (driverClassName != null) {
        config.setDriverClassName(driverClassName);
      }
    }
    config.setUsername(username);
    config.setPassword(password);
    config.setMaximumPoolSize(poolSize);
    config.setMinimumIdle(Math.max(2, Math.min(poolSize, 4)));
    config.setPoolName(poolName);
    config.setReadOnly(readOnly);
    config.setConnectionInitSql("SET search_path TO " + schema + ", public");
    return new HikariDataSource(config);
  }

  private static DataSource dataSourceForUrl(String url, String username, String password) {
    if (url != null && url.startsWith("jdbc:postgresql:")) {
      PGSimpleDataSource dataSource = new PGSimpleDataSource();
      dataSource.setUrl(url);
      dataSource.setUser(username);
      dataSource.setPassword(password);
      return dataSource;
    }
    return null;
  }

  private static String jdbcDriverClassName(String url) {
    if (url == null) {
      return null;
    }
    if (url.startsWith("jdbc:postgresql:")) {
      return "org.postgresql.Driver";
    }
    if (url.startsWith("jdbc:clickhouse:") || url.startsWith("jdbc:ch:")) {
      return "com.clickhouse.jdbc.ClickHouseDriver";
    }
    return null;
  }

  private static Set<String> parseCsv(String raw) {
    if (raw == null || raw.isBlank()) {
      return Set.of();
    }
    Set<String> values = new LinkedHashSet<>();
    for (String token : raw.split(",")) {
      String value = token.trim();
      if (!value.isBlank()) {
        values.add(value);
      }
    }
    return Set.copyOf(values);
  }

  private static String requireEnv(String key) {
    String value = System.getenv(key);
    if (value == null || value.isBlank()) {
      throw new IllegalStateException(key + " must be configured");
    }
    return value.trim();
  }
}
