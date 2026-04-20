package com.fern.services.product.infrastructure;

import com.dorabets.common.middleware.ServiceException;
import com.fern.services.product.api.ProductDtos.PresignedUploadResult;
import java.time.Duration;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.PresignedPutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.model.PutObjectPresignRequest;

@Service
@ConditionalOnProperty(name = "S3_BUCKET_PRODUCT_IMAGES")
public class ProductImageStorage {

  private static final Set<String> ALLOWED_CONTENT_TYPES =
      Set.of("image/jpeg", "image/png", "image/webp");
  private static final long MAX_SIZE_BYTES = 5L * 1024 * 1024;
  private static final Duration PRESIGN_TTL = Duration.ofMinutes(5);

  private final S3Presigner presigner;
  private final S3Client s3Client;
  private final String bucket;
  private final String publicBaseUrl;

  public ProductImageStorage(
      S3Presigner presigner,
      S3Client s3Client,
      @Value("${S3_BUCKET_PRODUCT_IMAGES}") String bucket,
      @Value("${S3_PUBLIC_BASE_URL:}") String publicBaseUrl
  ) {
    this.presigner = presigner;
    this.s3Client = s3Client;
    this.bucket = bucket;
    this.publicBaseUrl = publicBaseUrl;
  }

  public PresignedUploadResult presignUpload(long productId, String contentType, long size) {
    if (contentType == null || !ALLOWED_CONTENT_TYPES.contains(contentType.trim().toLowerCase())) {
      throw ServiceException.badRequest("Unsupported image content type. Allowed: image/jpeg, image/png, image/webp");
    }
    if (size <= 0 || size > MAX_SIZE_BYTES) {
      throw ServiceException.badRequest("Image size must be between 1 byte and " + MAX_SIZE_BYTES + " bytes");
    }
    String normalized = contentType.trim().toLowerCase();
    String extension = switch (normalized) {
      case "image/jpeg" -> "jpg";
      case "image/png" -> "png";
      case "image/webp" -> "webp";
      default -> "bin";
    };
    String key = "products/" + productId + "/" + UUID.randomUUID() + "." + extension;

    PutObjectRequest objectRequest = PutObjectRequest.builder()
        .bucket(bucket)
        .key(key)
        .contentType(normalized)
        .build();

    PutObjectPresignRequest presignRequest = PutObjectPresignRequest.builder()
        .signatureDuration(PRESIGN_TTL)
        .putObjectRequest(objectRequest)
        .build();

    PresignedPutObjectRequest presigned = presigner.presignPutObject(presignRequest);
    String finalUrl = buildFinalUrl(key);

    return new PresignedUploadResult(
        presigned.url().toString(),
        finalUrl,
        Instant.now().plus(PRESIGN_TTL).toString(),
        normalized
    );
  }

  public void deleteObject(String imageUrl) {
    if (imageUrl == null || imageUrl.isBlank() || publicBaseUrl == null || publicBaseUrl.isBlank()) {
      return;
    }
    if (!imageUrl.startsWith(publicBaseUrl)) {
      return;
    }
    String key = imageUrl.substring(publicBaseUrl.length());
    if (key.startsWith("/")) key = key.substring(1);
    s3Client.deleteObject(DeleteObjectRequest.builder().bucket(bucket).key(key).build());
  }

  private String buildFinalUrl(String key) {
    if (publicBaseUrl != null && !publicBaseUrl.isBlank()) {
      String base = publicBaseUrl.endsWith("/") ? publicBaseUrl.substring(0, publicBaseUrl.length() - 1) : publicBaseUrl;
      return base + "/" + key;
    }
    return "https://" + bucket + ".s3.amazonaws.com/" + key;
  }
}
