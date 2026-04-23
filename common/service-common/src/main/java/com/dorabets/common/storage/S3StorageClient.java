package com.dorabets.common.storage;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;

import java.io.InputStream;
import java.net.URI;
import java.time.Duration;

/**
 * S3-compatible storage client backed by AWS SDK v2.
 * Supports both AWS S3 and MinIO (via custom endpoint).
 * Activated when {@code storage.s3.enabled=true}.
 */
@Component
@ConditionalOnProperty(name = "storage.s3.enabled", havingValue = "true")
public class S3StorageClient {

    private static final Logger log = LoggerFactory.getLogger(S3StorageClient.class);

    private final S3Client s3Client;
    private final S3Presigner presigner;

    public S3StorageClient(
            @Value("${storage.s3.endpoint:}") String endpoint,
            @Value("${storage.s3.access-key}") String accessKey,
            @Value("${storage.s3.secret-key}") String secretKey,
            @Value("${storage.s3.region:us-east-1}") String region
    ) {
        AwsBasicCredentials credentials = AwsBasicCredentials.create(accessKey, secretKey);
        StaticCredentialsProvider credentialsProvider = StaticCredentialsProvider.create(credentials);
        Region awsRegion = Region.of(region);

        var s3Builder = S3Client.builder()
                .credentialsProvider(credentialsProvider)
                .region(awsRegion)
                .forcePathStyle(true); // required for MinIO

        var presignerBuilder = S3Presigner.builder()
                .credentialsProvider(credentialsProvider)
                .region(awsRegion);

        if (endpoint != null && !endpoint.isBlank()) {
            URI endpointUri = URI.create(endpoint);
            s3Builder.endpointOverride(endpointUri);
            presignerBuilder.endpointOverride(endpointUri);
        }

        this.s3Client = s3Builder.build();
        this.presigner = presignerBuilder.build();
        log.info("S3StorageClient initialised — endpoint={}, region={}", endpoint, region);
    }

    /**
     * Upload a file (or any InputStream) to the given bucket/key.
     *
     * @param bucket        target bucket name
     * @param key           object key (path)
     * @param data          input stream with the file data
     * @param contentLength byte length of the stream
     * @param contentType   MIME type
     * @return the S3 object URL (path-style)
     */
    public String uploadFile(String bucket, String key, InputStream data,
                             long contentLength, String contentType) {
        PutObjectRequest request = PutObjectRequest.builder()
                .bucket(bucket)
                .key(key)
                .contentType(contentType)
                .contentLength(contentLength)
                .build();

        s3Client.putObject(request, RequestBody.fromInputStream(data, contentLength));
        String url = s3Client.utilities().getUrl(b -> b.bucket(bucket).key(key)).toExternalForm();
        log.debug("Uploaded s3://{}/{} → {}", bucket, key, url);
        return url;
    }

    /**
     * Generate a pre-signed GET URL for the given bucket/key that expires after {@code ttl}.
     *
     * @param bucket target bucket name
     * @param key    object key
     * @param ttl    how long the pre-signed URL should remain valid
     * @return pre-signed URL string
     */
    public String generatePresignedUrl(String bucket, String key, Duration ttl) {
        GetObjectPresignRequest presignRequest = GetObjectPresignRequest.builder()
                .signatureDuration(ttl)
                .getObjectRequest(b -> b.bucket(bucket).key(key))
                .build();

        String url = presigner.presignGetObject(presignRequest).url().toExternalForm();
        log.debug("Pre-signed URL for s3://{}/{} (ttl={}): {}", bucket, key, ttl, url);
        return url;
    }
}
