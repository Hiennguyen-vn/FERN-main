package com.fern.services.sales.infrastructure;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;

/**
 * Indexes products and audit-log entries into OpenSearch via its REST API.
 * Uses the JDK {@link HttpClient} so no additional runtime dependency is required.
 * Activated when {@code search.opensearch.enabled=true}.
 */
@Component
@ConditionalOnProperty(name = "search.opensearch.enabled", havingValue = "true")
public class SearchIndexer {

    private static final Logger log = LoggerFactory.getLogger(SearchIndexer.class);

    private static final String PRODUCTS_INDEX   = "products";
    private static final String AUDIT_LOGS_INDEX = "audit-logs";

    private final HttpClient   httpClient;
    private final ObjectMapper mapper;
    private final String       baseUrl;

    public SearchIndexer(
            @Value("${search.opensearch.host:opensearch}") String host,
            @Value("${search.opensearch.port:9200}") int port,
            @Value("${search.opensearch.scheme:http}") String scheme,
            ObjectMapper mapper
    ) {
        this.baseUrl    = scheme + "://" + host + ":" + port;
        this.mapper     = mapper;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .build();
        log.info("SearchIndexer connected to OpenSearch at {}", this.baseUrl);
    }

    /**
     * Upsert a product document into the {@code products} index.
     *
     * @param productId    unique product identifier
     * @param name         product display name
     * @param categoryName human-readable category name
     */
    public void indexProduct(long productId, String name, String categoryName) {
        Map<String, Object> doc = Map.of(
                "product_id",    productId,
                "name",          name,
                "category_name", categoryName,
                "updated_at",    Instant.now().toString()
        );
        upsert(PRODUCTS_INDEX, String.valueOf(productId), doc);
    }

    /**
     * Index an audit-log entry into the {@code audit-logs} index.
     *
     * @param auditId    unique audit record identifier
     * @param action     action performed (e.g. CREATE, UPDATE, DELETE)
     * @param entityName entity type name (e.g. "Product", "Sale")
     * @param entityId   identifier of the affected entity
     */
    public void indexAuditLog(long auditId, String action, String entityName, String entityId) {
        Map<String, Object> doc = Map.of(
                "audit_id",    auditId,
                "action",      action,
                "entity_name", entityName,
                "entity_id",   entityId,
                "timestamp",   Instant.now().toString()
        );
        upsert(AUDIT_LOGS_INDEX, String.valueOf(auditId), doc);
    }

    // ── internals ────────────────────────────────────────────────────────────

    /**
     * PUT /{index}/_doc/{id} — creates or replaces the document (idempotent upsert).
     */
    private void upsert(String index, String id, Map<String, Object> doc) {
        String url  = baseUrl + "/" + index + "/_doc/" + id;
        String body = toJson(doc);

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .timeout(Duration.ofSeconds(10))
                .header("Content-Type", "application/json")
                .PUT(HttpRequest.BodyPublishers.ofString(body))
                .build();

        try {
            HttpResponse<String> response =
                    httpClient.send(request, HttpResponse.BodyHandlers.ofString());

            int status = response.statusCode();
            if (status >= 200 && status < 300) {
                log.debug("Indexed {}/{} → HTTP {}", index, id, status);
            } else {
                log.warn("OpenSearch returned HTTP {} for {}/{}: {}", status, index, id, response.body());
            }
        } catch (Exception e) {
            log.error("Failed to index {}/{} into OpenSearch: {}", index, id, e.getMessage(), e);
        }
    }

    private String toJson(Object value) {
        try {
            return mapper.writeValueAsString(value);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to serialise document to JSON", e);
        }
    }
}
