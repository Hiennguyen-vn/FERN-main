package com.fern.services.finance.infrastructure;

import com.fern.common.middleware.ServiceException;
import java.net.URI;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.AwsCredentialsProvider;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3ClientBuilder;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.NoSuchBucketException;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;

@Component
@ConditionalOnExpression("!'${S3_BUCKET_FINANCE_DOCUMENTS:}'.isBlank()")
public class S3ExpenseDocumentStorage implements ExpenseDocumentStorage {

  private static final Duration DOWNLOAD_TTL = Duration.ofMinutes(15);

  private final String bucket;
  private final String publicBaseUrl;
  private final S3Client s3Client;
  private final S3Presigner s3Presigner;

  public S3ExpenseDocumentStorage(
      @Value("${S3_BUCKET_FINANCE_DOCUMENTS}") String bucket,
      @Value("${S3_PUBLIC_BASE_URL:}") String publicBaseUrl,
      @Value("${AWS_REGION:ap-southeast-1}") String region,
      @Value("${AWS_ACCESS_KEY_ID:}") String accessKey,
      @Value("${AWS_SECRET_ACCESS_KEY:}") String secretKey,
      @Value("${S3_ENDPOINT:}") String endpoint,
      @Value("${S3_DOWNLOAD_ENDPOINT:}") String downloadEndpoint,
      @Value("${S3_PATH_STYLE:true}") boolean pathStyle
  ) {
    this.bucket = bucket;
    this.publicBaseUrl = publicBaseUrl == null ? "" : publicBaseUrl.strip();
    AwsCredentialsProvider credentials = credentials(accessKey, secretKey);
    S3Configuration s3Configuration = S3Configuration.builder()
        .pathStyleAccessEnabled(pathStyle)
        .build();
    S3ClientBuilder clientBuilder = S3Client.builder()
        .region(Region.of(region))
        .credentialsProvider(credentials)
        .serviceConfiguration(s3Configuration);
    S3Presigner.Builder presignerBuilder = S3Presigner.builder()
        .region(Region.of(region))
        .credentialsProvider(credentials)
        .serviceConfiguration(s3Configuration);
    if (endpoint != null && !endpoint.isBlank()) {
      URI endpointUri = URI.create(endpoint);
      clientBuilder.endpointOverride(endpointUri);
    }
    String presignEndpoint = downloadEndpoint != null && !downloadEndpoint.isBlank()
        ? downloadEndpoint
        : endpoint;
    if (presignEndpoint != null && !presignEndpoint.isBlank()) {
      presignerBuilder.endpointOverride(URI.create(presignEndpoint));
    }
    this.s3Client = clientBuilder.build();
    this.s3Presigner = presignerBuilder.build();
  }

  @Override
  public StoredObject upload(String objectKey, String fileName, String contentType, byte[] content) {
    PutObjectRequest request = PutObjectRequest.builder()
        .bucket(bucket)
        .key(objectKey)
        .contentType(contentType)
        .contentLength((long) content.length)
        .contentDisposition("inline; filename=\"" + fileName.replace("\"", "") + "\"")
        .build();
    try {
      s3Client.putObject(request, RequestBody.fromBytes(content));
    } catch (NoSuchBucketException e) {
      throw ServiceException.conflict("EXPENSE_DOCUMENT_BUCKET_NOT_FOUND");
    } catch (S3Exception e) {
      throw new ServiceException(503, "storage_unavailable", "EXPENSE_DOCUMENT_STORAGE_UNAVAILABLE");
    }
    return new StoredObject(objectKey, downloadUrl(objectKey));
  }

  @Override
  public String downloadUrl(String objectKey) {
    if (!publicBaseUrl.isBlank()) {
      return publicBaseUrl.replaceAll("/+$", "") + "/" + objectKey;
    }
    GetObjectRequest getObjectRequest = GetObjectRequest.builder()
        .bucket(bucket)
        .key(objectKey)
        .build();
    GetObjectPresignRequest presignRequest = GetObjectPresignRequest.builder()
        .signatureDuration(DOWNLOAD_TTL)
        .getObjectRequest(getObjectRequest)
        .build();
    return s3Presigner.presignGetObject(presignRequest).url().toExternalForm();
  }

  private static AwsCredentialsProvider credentials(String accessKey, String secretKey) {
    if (accessKey != null && !accessKey.isBlank() && secretKey != null && !secretKey.isBlank()) {
      return StaticCredentialsProvider.create(AwsBasicCredentials.create(accessKey, secretKey));
    }
    return DefaultCredentialsProvider.create();
  }
}
