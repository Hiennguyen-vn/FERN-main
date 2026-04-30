package com.fern.services.product.infrastructure;

import com.fern.common.middleware.ServiceException;
import com.fern.services.product.api.ProductDtos.PresignedUploadResult;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.PresignedPutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.model.PutObjectPresignRequest;
import software.amazon.awssdk.core.ResponseBytes;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;

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
  private final String consoleEndpoint;
  private final String accessKey;
  private final String secretKey;
  private final HttpClient httpClient;

  public ProductImageStorage(
      S3Presigner presigner,
      S3Client s3Client,
      @Value("${S3_BUCKET_PRODUCT_IMAGES}") String bucket,
      @Value("${S3_PUBLIC_BASE_URL:}") String publicBaseUrl,
      @Value("${S3_CONSOLE_ENDPOINT:}") String consoleEndpoint,
      @Value("${AWS_ACCESS_KEY_ID:}") String accessKey,
      @Value("${AWS_SECRET_ACCESS_KEY:}") String secretKey
  ) {
    this.presigner = presigner;
    this.s3Client = s3Client;
    this.bucket = bucket;
    this.publicBaseUrl = publicBaseUrl;
    this.consoleEndpoint = trimTrailingSlash(consoleEndpoint);
    this.accessKey = accessKey;
    this.secretKey = secretKey;
    this.httpClient = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(10))
        .build();
  }

  public PresignedUploadResult presignUpload(long productId, String contentType, long size) {
    String normalized = validateContentType(contentType);
    validateSize(size);
    String key = buildKey(productId, normalized);

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

  public PresignedUploadResult uploadObject(
      long productId,
      String contentType,
      String originalFilename,
      byte[] data
  ) {
    String normalized = validateContentType(contentType);
    validateSize(data == null ? 0 : data.length);
    String key = buildKey(productId, normalized);

    if (consoleEndpoint != null && !consoleEndpoint.isBlank()) {
      uploadWithConsoleApi(key, normalized, originalFilename, data);
    } else {
      s3Client.putObject(
          PutObjectRequest.builder()
              .bucket(bucket)
              .key(key)
              .contentType(normalized)
              .build(),
          RequestBody.fromBytes(data)
      );
    }

    return new PresignedUploadResult("", buildFinalUrl(key), "", normalized);
  }

  public StoredObject readObject(String key) {
    String normalizedKey = validateObjectKey(key);

    if (consoleEndpoint != null && !consoleEndpoint.isBlank()) {
      return downloadWithConsoleApi(normalizedKey);
    }

    ResponseBytes<GetObjectResponse> object = s3Client.getObjectAsBytes(
        GetObjectRequest.builder().bucket(bucket).key(normalizedKey).build()
    );
    String contentType = object.response().contentType();
    return new StoredObject(
        object.asByteArray(),
        contentType == null || contentType.isBlank() ? "application/octet-stream" : contentType
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
    if (consoleEndpoint != null && !consoleEndpoint.isBlank()) {
      return "/api/v1/product/product-images?key=" + URLEncoder.encode(key, StandardCharsets.UTF_8);
    }
    if (publicBaseUrl != null && !publicBaseUrl.isBlank()) {
      String base = publicBaseUrl.endsWith("/") ? publicBaseUrl.substring(0, publicBaseUrl.length() - 1) : publicBaseUrl;
      return base + "/" + key;
    }
    return "https://" + bucket + ".s3.amazonaws.com/" + key;
  }

  private String validateContentType(String contentType) {
    if (contentType == null || !ALLOWED_CONTENT_TYPES.contains(contentType.trim().toLowerCase())) {
      throw ServiceException.badRequest("Unsupported image content type. Allowed: image/jpeg, image/png, image/webp");
    }
    return contentType.trim().toLowerCase();
  }

  private void validateSize(long size) {
    if (size <= 0 || size > MAX_SIZE_BYTES) {
      throw ServiceException.badRequest("Image size must be between 1 byte and " + MAX_SIZE_BYTES + " bytes");
    }
  }

  private String buildKey(long productId, String contentType) {
    String extension = switch (contentType) {
      case "image/jpeg" -> "jpg";
      case "image/png" -> "png";
      case "image/webp" -> "webp";
      default -> "bin";
    };
    return "products/" + productId + "/" + UUID.randomUUID() + "." + extension;
  }

  private String validateObjectKey(String key) {
    if (key == null || key.isBlank()) {
      throw ServiceException.badRequest("Image key is required");
    }
    String normalized = key.trim();
    if (!normalized.startsWith("products/") || normalized.contains("..")) {
      throw ServiceException.badRequest("Invalid image key");
    }
    return normalized;
  }

  private void uploadWithConsoleApi(String key, String contentType, String originalFilename, byte[] data) {
    String cookie = loginConsole();
    String filename = sanitizeFilename(originalFilename, key);
    String boundary = "----fern-product-image-" + UUID.randomUUID();
    byte[] body = multipartBody(boundary, "file", filename, contentType, data);
    HttpResponse<String> response = sendConsoleUpload(cookie, boundary, body, key);
    if (response.statusCode() >= 200 && response.statusCode() < 300) {
      return;
    }

    if (isConsoleSizeFieldRequired(response.body())) {
      String legacyBoundary = "----fern-product-image-" + UUID.randomUUID();
      byte[] legacyBody = multipartBody(legacyBoundary, String.valueOf(data.length), filename, contentType, data);
      response = sendConsoleUpload(cookie, legacyBoundary, legacyBody, key);
      if (response.statusCode() >= 200 && response.statusCode() < 300) {
        return;
      }
    }

    throw ServiceException.badRequest("S3 console upload failed (" + response.statusCode() + "): "
        + trimResponse(response.body()));
  }

  private HttpResponse<String> sendConsoleUpload(String cookie, String boundary, byte[] body, String key) {
    HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create(consoleEndpoint + "/api/v1/buckets/" + encodePath(bucket)
            + "/objects/upload?prefix=" + encodeQuery(key)))
        .timeout(Duration.ofSeconds(30))
        .header("Cookie", cookie)
        .header("Content-Type", "multipart/form-data; boundary=" + boundary)
        .POST(HttpRequest.BodyPublishers.ofByteArray(body))
        .build();
    return sendString(request);
  }

  private StoredObject downloadWithConsoleApi(String key) {
    String cookie = loginConsole();
    HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create(consoleEndpoint + "/api/v1/buckets/" + encodePath(bucket)
            + "/objects/download?prefix=" + encodeQuery(key)))
        .timeout(Duration.ofSeconds(30))
        .header("Cookie", cookie)
        .GET()
        .build();
    HttpResponse<byte[]> response = sendBytes(request);
    if (response.statusCode() < 200 || response.statusCode() >= 300) {
      throw ServiceException.notFound("Image object was not found");
    }
    String contentType = response.headers().firstValue("content-type").orElse("application/octet-stream");
    return new StoredObject(response.body(), contentType);
  }

  private String loginConsole() {
    if (accessKey == null || accessKey.isBlank() || secretKey == null || secretKey.isBlank()) {
      throw ServiceException.badRequest("S3 console credentials are not configured");
    }
    String body = "{\"accessKey\":\"" + jsonEscape(accessKey) + "\",\"secretKey\":\"" + jsonEscape(secretKey) + "\"}";
    HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create(consoleEndpoint + "/api/v1/login"))
        .timeout(Duration.ofSeconds(15))
        .header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(body))
        .build();
    HttpResponse<String> response = sendString(request);
    if (response.statusCode() < 200 || response.statusCode() >= 300) {
      throw ServiceException.badRequest("S3 console login failed (" + response.statusCode() + ")");
    }
    List<String> cookies = response.headers().allValues("set-cookie");
    return cookies.stream()
        .filter(cookie -> cookie.startsWith("token="))
        .map(cookie -> cookie.split(";", 2)[0])
        .findFirst()
        .orElseThrow(() -> ServiceException.badRequest("S3 console login did not return a session"));
  }

  private HttpResponse<String> sendString(HttpRequest request) {
    try {
      return httpClient.send(request, HttpResponse.BodyHandlers.ofString());
    } catch (IOException ex) {
      throw ServiceException.badRequest("S3 console request failed: " + ex.getMessage());
    } catch (InterruptedException ex) {
      Thread.currentThread().interrupt();
      throw ServiceException.badRequest("S3 console request was interrupted");
    }
  }

  private HttpResponse<byte[]> sendBytes(HttpRequest request) {
    try {
      return httpClient.send(request, HttpResponse.BodyHandlers.ofByteArray());
    } catch (IOException ex) {
      throw ServiceException.badRequest("S3 console request failed: " + ex.getMessage());
    } catch (InterruptedException ex) {
      Thread.currentThread().interrupt();
      throw ServiceException.badRequest("S3 console request was interrupted");
    }
  }

  private byte[] multipartBody(
      String boundary,
      String fieldName,
      String filename,
      String contentType,
      byte[] data
  ) {
    try {
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      out.write(("--" + boundary + "\r\n").getBytes(StandardCharsets.UTF_8));
      out.write(("Content-Disposition: form-data; name=\"" + fieldName + "\"; filename=\""
          + filename + "\"\r\n").getBytes(StandardCharsets.UTF_8));
      out.write(("Content-Type: " + contentType + "\r\n\r\n").getBytes(StandardCharsets.UTF_8));
      out.write(data);
      out.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
      return out.toByteArray();
    } catch (IOException ex) {
      throw ServiceException.badRequest("Failed to prepare image upload");
    }
  }

  private static String sanitizeFilename(String originalFilename, String key) {
    String fallback = key.substring(key.lastIndexOf('/') + 1);
    String filename = originalFilename == null || originalFilename.isBlank() ? fallback : originalFilename.trim();
    return filename.replace("\"", "").replace("\\", "").replace("/", "");
  }

  private static String trimTrailingSlash(String value) {
    if (value == null) return "";
    String trimmed = value.trim();
    return trimmed.endsWith("/") ? trimmed.substring(0, trimmed.length() - 1) : trimmed;
  }

  private static String encodePath(String value) {
    return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
  }

  private static String encodeQuery(String value) {
    return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
  }

  private static String jsonEscape(String value) {
    return value.replace("\\", "\\\\").replace("\"", "\\\"");
  }

  private static String trimResponse(String value) {
    if (value == null) return "";
    return value.length() <= 200 ? value : value.substring(0, 200);
  }

  private static boolean isConsoleSizeFieldRequired(String responseBody) {
    return responseBody != null
        && responseBody.contains("strconv.ParseInt")
        && responseBody.contains("parsing \\\"file\\\"");
  }

  public record StoredObject(byte[] data, String contentType) {}
}
