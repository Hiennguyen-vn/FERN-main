package com.fern.gateway.routing;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Catalog snapshot — fails when routes added/removed/reclassified.
 * Update snapshot file deliberately when changing routing surface.
 */
class GatewayRouteCatalogSnapshotTest {

  @Test
  void catalogMatchesSnapshot() throws IOException {
    List<String> actual = GatewayRouteCatalog.routes().stream()
        .map(r -> r.pathPrefix() + "|" + r.serviceName() + "|" + r.routeClass() + "|" + r.rateLimitTier())
        .sorted()
        .toList();

    String expected;
    try (InputStream is = getClass().getClassLoader().getResourceAsStream("route-catalog.snapshot.txt")) {
      if (is == null) {
        throw new IllegalStateException("route-catalog.snapshot.txt missing on test classpath");
      }
      expected = new String(is.readAllBytes(), StandardCharsets.UTF_8);
    }
    String actualText = String.join("\n", actual) + "\n";
    assertEquals(expected, actualText,
        "Route catalog drifted from snapshot. Update gateway/src/test/resources/route-catalog.snapshot.txt deliberately.");
  }
}
