package com.dorabets.common.spring.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "dependencies")
public class FernServiceProperties {

  private final Postgres postgres = new Postgres();
  private final Redis redis = new Redis();
  private final Kafka kafka = new Kafka();
  private final MasterNode masterNode = new MasterNode();

  public Postgres getPostgres() {
    return postgres;
  }

  public Redis getRedis() {
    return redis;
  }

  public Kafka getKafka() {
    return kafka;
  }

  public MasterNode getMasterNode() {
    return masterNode;
  }

  public static class Postgres {

    private String url = "jdbc:postgresql://localhost:5432/fern";
    private String replicaUrl = "";
    private String username = "fern";
    private String password = "fern";
    private int poolSize = 16;
    private String schema = "core";

    public String getUrl() {
      return url;
    }

    public void setUrl(String url) {
      this.url = url;
    }

    public String getReplicaUrl() {
      return replicaUrl;
    }

    public void setReplicaUrl(String replicaUrl) {
      this.replicaUrl = replicaUrl;
    }

    public String getUsername() {
      return username;
    }

    public void setUsername(String username) {
      this.username = username;
    }

    public String getPassword() {
      return password;
    }

    public void setPassword(String password) {
      this.password = password;
    }

    public int getPoolSize() {
      return poolSize;
    }

    public void setPoolSize(int poolSize) {
      this.poolSize = poolSize;
    }

    public String getSchema() {
      return schema;
    }

    public void setSchema(String schema) {
      this.schema = schema;
    }
  }

  public static class Redis {

    private String host = "localhost";
    private int port = 6379;
    private int timeoutMillis = 2_000;
    private String password = "";

    public String getHost() {
      return host;
    }

    public void setHost(String host) {
      this.host = host;
    }

    public int getPort() {
      return port;
    }

    public void setPort(int port) {
      this.port = port;
    }

    public int getTimeoutMillis() {
      return timeoutMillis;
    }

    public void setTimeoutMillis(int timeoutMillis) {
      this.timeoutMillis = timeoutMillis;
    }

    public String getPassword() {
      return password;
    }

    public void setPassword(String password) {
      this.password = password;
    }
  }

  public static class Kafka {

    private String bootstrap = "localhost:9092";
    private String clientIdPrefix = "fern";
    private String consumerGroupPrefix = "fern";

    public String getBootstrap() {
      return bootstrap;
    }

    public void setBootstrap(String bootstrap) {
      this.bootstrap = bootstrap;
    }

    public String getClientIdPrefix() {
      return clientIdPrefix;
    }

    public void setClientIdPrefix(String clientIdPrefix) {
      this.clientIdPrefix = clientIdPrefix;
    }

    public String getConsumerGroupPrefix() {
      return consumerGroupPrefix;
    }

    public void setConsumerGroupPrefix(String consumerGroupPrefix) {
      this.consumerGroupPrefix = consumerGroupPrefix;
    }
  }

  public static class MasterNode {

    private String baseUrl = "http://localhost:8082";
    private boolean heartbeatEnabled = true;
    private int heartbeatLeaseSeconds = 30;
    private int heartbeatIntervalSeconds = 10;

    public String getBaseUrl() {
      return baseUrl;
    }

    public void setBaseUrl(String baseUrl) {
      this.baseUrl = baseUrl;
    }

    public boolean isHeartbeatEnabled() {
      return heartbeatEnabled;
    }

    public void setHeartbeatEnabled(boolean heartbeatEnabled) {
      this.heartbeatEnabled = heartbeatEnabled;
    }

    public int getHeartbeatLeaseSeconds() {
      return heartbeatLeaseSeconds;
    }

    public void setHeartbeatLeaseSeconds(int heartbeatLeaseSeconds) {
      this.heartbeatLeaseSeconds = heartbeatLeaseSeconds;
    }

    public int getHeartbeatIntervalSeconds() {
      return heartbeatIntervalSeconds;
    }

    public void setHeartbeatIntervalSeconds(int heartbeatIntervalSeconds) {
      this.heartbeatIntervalSeconds = heartbeatIntervalSeconds;
    }
  }
}
