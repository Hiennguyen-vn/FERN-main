package com.fern.services.finance.infrastructure;

import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class S3ExpenseDocumentStorageTest {

  @Test
  void downloadUrlUsesBrowserReachableEndpointWhenConfigured() {
    S3ExpenseDocumentStorage storage = new S3ExpenseDocumentStorage(
        "fern-exports",
        "",
        "ap-southeast-1",
        "minioadmin",
        "minioadmin",
        "http://minio:9000",
        "http://localhost:9000",
        true
    );

    String url = storage.downloadUrl("finance/expenses/7/501/900.pdf");

    assertTrue(url.startsWith("http://localhost:9000/fern-exports/finance/expenses/7/501/900.pdf"));
    assertTrue(url.contains("X-Amz-Signature="));
  }
}
