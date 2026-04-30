package com.fern.services.finance.infrastructure;

public interface ExpenseDocumentStorage {

  record StoredObject(
      String objectKey,
      String url
  ) {
  }

  StoredObject upload(String objectKey, String fileName, String contentType, byte[] content);

  String downloadUrl(String objectKey);
}
