package com.fern.services.product.infrastructure;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import com.fern.common.middleware.ServiceException;
import com.fern.services.product.api.ProductDtos.PresignedUploadResult;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

class ProductImageStorageTest {

  private static final long MAX_SIZE_BYTES = 50L * 1024 * 1024;

  private final S3Client s3Client = mock(S3Client.class);
  private final ProductImageStorage storage = new ProductImageStorage(
      mock(S3Presigner.class),
      s3Client,
      "fern-product-images",
      "",
      "",
      "",
      ""
  );

  @ParameterizedTest
  @ValueSource(strings = {"image/png", "image/jpeg", "image/webp"})
  void uploadObjectAcceptsSupportedImageTypes(String contentType) {
    byte[] data = new byte[] {1, 2, 3};

    PresignedUploadResult result = assertDoesNotThrow(
        () -> storage.uploadObject(123L, contentType, "product-image", data)
    );

    assertEquals(contentType, result.contentType());
    verify(s3Client).putObject(any(PutObjectRequest.class), any(RequestBody.class));
  }

  @ParameterizedTest
  @ValueSource(strings = {"text/plain", "image/gif", "application/octet-stream"})
  void uploadObjectRejectsUnsupportedContentTypes(String contentType) {
    ServiceException exception = assertThrows(
        ServiceException.class,
        () -> storage.uploadObject(123L, contentType, "product-image", new byte[] {1})
    );

    assertEquals(400, exception.getStatusCode());
  }

  @Test
  void uploadObjectRejectsEmptyImages() {
    ServiceException exception = assertThrows(
        ServiceException.class,
        () -> storage.uploadObject(123L, "image/png", "empty.png", new byte[0])
    );

    assertEquals(400, exception.getStatusCode());
  }

  @Test
  void uploadObjectRejectsImagesOverConfiguredLimit() {
    ServiceException exception = assertThrows(
        ServiceException.class,
        () -> storage.uploadObject(123L, "image/png", "large.png", new byte[(int) MAX_SIZE_BYTES + 1])
    );

    assertEquals(400, exception.getStatusCode());
  }

  @Test
  void consoleMultipartBodyUsesFileFieldName() throws Exception {
    Method method = ProductImageStorage.class.getDeclaredMethod(
        "multipartBody",
        String.class,
        String.class,
        String.class,
        String.class,
        byte[].class
    );
    method.setAccessible(true);

    byte[] body = (byte[]) method.invoke(
        storage,
        "test-boundary",
        "file",
        "product.png",
        "image/png",
        new byte[] {1, 2, 3}
    );
    String text = new String(body, StandardCharsets.ISO_8859_1);

    assertEquals(1, Stream.of(text.split("name=\"file\"", -1)).count() - 1);
  }
}
