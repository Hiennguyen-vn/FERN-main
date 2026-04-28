package com.fern.services.sales.infrastructure;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class SearchIndexerTest {

  @Test
  void indexesProductAndAuditDocumentsOverHttp() throws Exception {
    List<String> paths = new ArrayList<>();
    List<String> bodies = new ArrayList<>();
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/", exchange -> {
      paths.add(exchange.getRequestURI().getPath());
      bodies.add(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
      byte[] response = "ok".getBytes(StandardCharsets.UTF_8);
      int status = paths.size() == 1 ? 201 : 500;
      exchange.sendResponseHeaders(status, response.length);
      exchange.getResponseBody().write(response);
      exchange.close();
    });
    server.start();

    try {
      SearchIndexer indexer = new SearchIndexer(
          "127.0.0.1",
          server.getAddress().getPort(),
          "http",
          new ObjectMapper());

      assertDoesNotThrow(() -> indexer.indexProduct(42L, "Latte", "Coffee"));
      assertDoesNotThrow(() -> indexer.indexAuditLog(99L, "CREATE", "Product", "42"));

      assertEquals(List.of("/products/_doc/42", "/audit-logs/_doc/99"), paths);
      assertTrue(bodies.get(0).contains("\"product_id\":42"));
      assertTrue(bodies.get(0).contains("\"name\":\"Latte\""));
      assertTrue(bodies.get(1).contains("\"audit_id\":99"));
      assertTrue(bodies.get(1).contains("\"entity_name\":\"Product\""));
    } finally {
      server.stop(0);
    }
  }

  @Test
  void serializationFailureIsReportedBeforeHttpRequest() throws Exception {
    ObjectMapper mapper = mock(ObjectMapper.class);
    when(mapper.writeValueAsString(org.mockito.ArgumentMatchers.any()))
        .thenThrow(new RuntimeException("cannot serialize"));
    SearchIndexer indexer = new SearchIndexer("127.0.0.1", 9, "http", mapper);

    assertThrows(IllegalStateException.class, () -> indexer.indexProduct(1L, "Latte", "Coffee"));
  }
}
