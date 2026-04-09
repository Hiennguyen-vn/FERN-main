package com.dorabets.common.spring.config;

import com.dorabets.common.event.EventPublisher;
import com.dorabets.idempotency.IdempotencyGuard;
import com.dorabets.common.spring.auth.JwtTokenService;
import com.dorabets.common.spring.auth.SpringInternalServiceAuth;
import com.dorabets.common.spring.cache.JacksonCacheSerializer;
import com.dorabets.common.spring.cache.JedisRedisClientAdapter;
import com.dorabets.common.spring.events.TypedKafkaEventPublisher;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.natsu.common.model.cache.RedisClientAdapter;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.time.Clock;
import java.util.Map;
import javax.sql.DataSource;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.common.serialization.StringSerializer;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.kafka.config.ConcurrentKafkaListenerContainerFactory;
import org.springframework.kafka.core.ConsumerFactory;
import org.springframework.kafka.core.DefaultKafkaConsumerFactory;
import org.springframework.web.client.RestClient;
import redis.clients.jedis.JedisPool;
import redis.clients.jedis.JedisPoolConfig;

@Configuration
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
  public JedisPool jedisPool(FernServiceProperties properties) {
    JedisPoolConfig config = new JedisPoolConfig();
    config.setMaxTotal(32);
    config.setMaxIdle(16);
    config.setMinIdle(2);
    FernServiceProperties.Redis redis = properties.getRedis();
    if (redis.getPassword() != null && !redis.getPassword().isBlank()) {
      return new JedisPool(config, redis.getHost(), redis.getPort(), redis.getTimeoutMillis(), redis.getPassword());
    }
    return new JedisPool(config, redis.getHost(), redis.getPort(), redis.getTimeoutMillis());
  }

  @Bean
  @ConditionalOnMissingBean
  public RedisClientAdapter redisClientAdapter(JedisPool jedisPool) {
    return new JedisRedisClientAdapter(jedisPool);
  }

  @Bean
  @ConditionalOnMissingBean
  public IdempotencyGuard idempotencyGuard(JedisPool jedisPool, DataSource dataSource) {
    return new IdempotencyGuard(jedisPool, dataSource);
  }

  @Bean
  @ConditionalOnMissingBean
  public SnowflakeIdGenerator snowflakeIdGenerator(
      @Value("${WORKER_ID:1}") long workerId
  ) {
    return new SnowflakeIdGenerator(workerId);
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
      @Value("${spring.application.name:unknown-service}") String serviceName
  ) {
    Map<String, Object> config = Map.of(
        ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, properties.getKafka().getBootstrap(),
        ConsumerConfig.GROUP_ID_CONFIG, properties.getKafka().getConsumerGroupPrefix() + "." + serviceName + ".v1",
        ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class,
        ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class,
        ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest"
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
    return RestClient.builder().requestFactory(new JdkClientHttpRequestFactory());
  }

  @Bean
  @ConditionalOnMissingBean
  public JwtTokenService jwtTokenService(ObjectMapper objectMapper) {
    return new JwtTokenService(objectMapper, requireEnv("JWT_SECRET"));
  }

  @Bean
  @ConditionalOnMissingBean
  public SpringInternalServiceAuth springInternalServiceAuth() {
    return new SpringInternalServiceAuth();
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
    config.setJdbcUrl(url);
    config.setUsername(username);
    config.setPassword(password);
    config.setMaximumPoolSize(poolSize);
    config.setMinimumIdle(Math.max(2, Math.min(poolSize, 4)));
    config.setPoolName(poolName);
    config.setReadOnly(readOnly);
    config.setConnectionInitSql("SET search_path TO " + schema + ", public");
    return new HikariDataSource(config);
  }

  private static String requireEnv(String key) {
    String value = System.getenv(key);
    if (value == null || value.isBlank()) {
      throw new IllegalStateException(key + " must be configured");
    }
    return value.trim();
  }
}
