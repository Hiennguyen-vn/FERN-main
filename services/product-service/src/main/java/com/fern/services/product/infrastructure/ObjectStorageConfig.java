package com.fern.services.product.infrastructure;

import java.net.URI;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.AwsCredentialsProvider;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3ClientBuilder;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.S3Presigner.Builder;

@Configuration
@ConditionalOnProperty(name = "S3_BUCKET_PRODUCT_IMAGES")
public class ObjectStorageConfig {

  private final String region;
  private final String accessKey;
  private final String secretKey;
  private final String endpointOverride;
  private final boolean pathStyle;

  public ObjectStorageConfig(
      @Value("${AWS_REGION:ap-southeast-1}") String region,
      @Value("${AWS_ACCESS_KEY_ID:}") String accessKey,
      @Value("${AWS_SECRET_ACCESS_KEY:}") String secretKey,
      @Value("${S3_ENDPOINT:}") String endpointOverride,
      @Value("${S3_PATH_STYLE:false}") boolean pathStyle
  ) {
    this.region = region;
    this.accessKey = accessKey;
    this.secretKey = secretKey;
    this.endpointOverride = endpointOverride;
    this.pathStyle = pathStyle;
  }

  private AwsCredentialsProvider credentials() {
    if (accessKey != null && !accessKey.isBlank() && secretKey != null && !secretKey.isBlank()) {
      return StaticCredentialsProvider.create(AwsBasicCredentials.create(accessKey, secretKey));
    }
    return DefaultCredentialsProvider.create();
  }

  @Bean
  public S3Client s3Client() {
    S3ClientBuilder builder = S3Client.builder()
        .region(Region.of(region))
        .credentialsProvider(credentials())
        .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(pathStyle).build());
    if (endpointOverride != null && !endpointOverride.isBlank()) {
      builder.endpointOverride(URI.create(endpointOverride));
    }
    return builder.build();
  }

  @Bean
  public S3Presigner s3Presigner() {
    Builder builder = S3Presigner.builder()
        .region(Region.of(region))
        .credentialsProvider(credentials())
        .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(pathStyle).build());
    if (endpointOverride != null && !endpointOverride.isBlank()) {
      builder.endpointOverride(URI.create(endpointOverride));
    }
    return builder.build();
  }
}
